import type { KnowledgeEntry, KnowledgeHit, KnowledgeSource, KnowledgeStats } from '@teca/shared';
import path from 'node:path';
import { notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { JsonStore } from '../../core/store.js';
import type { Embedder } from './embedder.js';
import { SEED_ENTRIES } from './seed.js';
import { bm25Scores, cosine, normalizeScores, tokenize } from './vector.js';

interface StoredEntry extends KnowledgeEntry {
  embedding: number[];
  /** Embedding space the vector belongs to; mismatches trigger re-embedding. */
  signature: string;
}

interface KnowledgeData {
  entries: StoredEntry[];
  seeded: boolean;
}

export interface AddEntryInput {
  title: string;
  text: string;
  tags?: string[];
  source?: KnowledgeSource;
}

const VECTOR_WEIGHT = 0.65;
const LEXICAL_WEIGHT = 0.35;
const BATCH_SIZE = 32;

const strip = ({ embedding, signature, ...entry }: StoredEntry): KnowledgeEntry => entry;

const embeddableText = (entry: { title: string; text: string; tags: string[] }): string =>
  `${entry.title}\n${entry.tags.join(', ')}\n${entry.text}`;

/** Knowledge base with hybrid (dense + BM25) retrieval over the tiny vector store. */
export class KnowledgeService {
  private readonly store: JsonStore<KnowledgeData>;
  private reindexing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly embedder: Embedder,
  ) {
    this.store = new JsonStore<KnowledgeData>(path.join(dataDir, 'knowledge.json'), () => ({
      entries: [],
      seeded: false,
    }));
    this.seedIfEmpty();
  }

  private seedIfEmpty(): void {
    const data = this.store.get();
    if (data.seeded || data.entries.length > 0) return;
    const now = Date.now();
    this.store.update((d) => {
      d.entries = SEED_ENTRIES.map((seed, index) => ({
        id: newId('kb'),
        title: seed.title,
        text: seed.text,
        tags: seed.tags,
        source: 'seed' as const,
        createdAt: now + index,
        updatedAt: now + index,
        embedding: [],
        signature: '',
      }));
      d.seeded = true;
    });
  }

  list(): KnowledgeEntry[] {
    return this.store.get().entries.map(strip);
  }

  get(id: string): KnowledgeEntry {
    const entry = this.store.get().entries.find((e) => e.id === id);
    if (!entry) throw notFound(`Knowledge entry ${id}`);
    return strip(entry);
  }

  async add(input: AddEntryInput): Promise<KnowledgeEntry> {
    const now = Date.now();
    const entry: StoredEntry = {
      id: newId('kb'),
      title: input.title.trim(),
      text: input.text.trim(),
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      source: input.source ?? 'user',
      createdAt: now,
      updatedAt: now,
      embedding: [],
      signature: '',
    };
    const { vectors, signature } = await this.embedder.embed([embeddableText(entry)]);
    entry.embedding = vectors[0] ?? [];
    entry.signature = signature;
    this.store.update((d) => {
      d.entries.push(entry);
    });
    return strip(entry);
  }

  async update(
    id: string,
    patch: { title?: string; text?: string; tags?: string[] },
  ): Promise<KnowledgeEntry> {
    const entry = this.store.get().entries.find((e) => e.id === id);
    if (!entry) throw notFound(`Knowledge entry ${id}`);
    if (patch.title != null) entry.title = patch.title.trim();
    if (patch.text != null) entry.text = patch.text.trim();
    if (patch.tags) entry.tags = patch.tags.map((t) => t.trim()).filter(Boolean);
    entry.updatedAt = Date.now();
    const { vectors, signature } = await this.embedder.embed([embeddableText(entry)]);
    entry.embedding = vectors[0] ?? [];
    entry.signature = signature;
    this.store.update(() => undefined);
    return strip(entry);
  }

  remove(id: string): void {
    this.store.update((d) => {
      const index = d.entries.findIndex((e) => e.id === id);
      if (index < 0) throw notFound(`Knowledge entry ${id}`);
      d.entries.splice(index, 1);
    });
  }

  /** Re-embeds entries whose vectors are missing or belong to another space. */
  async reindex(force = false): Promise<void> {
    if (this.reindexing) return this.reindexing;
    this.reindexing = this.runReindex(force).finally(() => {
      this.reindexing = null;
    });
    return this.reindexing;
  }

  private async runReindex(force: boolean): Promise<void> {
    const expected = this.embedder.expectedSignature();
    const entries = this.store.get().entries;
    const stale = entries.filter(
      (e) => force || e.signature !== expected || e.embedding.length === 0,
    );
    if (stale.length === 0) return;

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const { vectors, signature } = await this.embedder.embed(batch.map(embeddableText));
      batch.forEach((entry, index) => {
        entry.embedding = vectors[index] ?? [];
        entry.signature = signature;
      });
    }
    this.store.update(() => undefined);
  }

  async search(query: string, topK = 5): Promise<KnowledgeHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    await this.reindex();

    const entries = this.store.get().entries;
    if (entries.length === 0) return [];

    const { vectors } = await this.embedder.embed([trimmed]);
    const queryVector = vectors[0] ?? [];

    const lexical = normalizeScores(
      bm25Scores(
        trimmed,
        entries.map((e) => ({ id: e.id, tokens: tokenize(embeddableText(e)) })),
      ),
    );

    return entries
      .map((entry) => {
        const vectorScore =
          queryVector.length && entry.embedding.length ? cosine(queryVector, entry.embedding) : 0;
        const lexicalScore = lexical.get(entry.id) ?? 0;
        return {
          ...strip(entry),
          vectorScore,
          lexicalScore,
          score: VECTOR_WEIGHT * vectorScore + LEXICAL_WEIGHT * lexicalScore,
        };
      })
      .filter((hit) => hit.score > 0.01)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK));
  }

  stats(): KnowledgeStats {
    const entries = this.store.get().entries;
    const signature = this.embedder.expectedSignature();
    return {
      entries: entries.length,
      dimensions: entries.find((e) => e.embedding.length)?.embedding.length ?? 0,
      embeddingModel: signature,
      remoteEmbeddings: signature.startsWith('remote:'),
    };
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
