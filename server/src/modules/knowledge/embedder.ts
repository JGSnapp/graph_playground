import type { LlmProvider } from '../llm/provider.js';
import type { SettingsService } from '../settings/settings.service.js';
import { localEmbed } from './vector.js';

export interface EmbedResult {
  vectors: number[][];
  /** Identifies which embedding space the vectors live in. */
  signature: string;
  remote: boolean;
}

const LOCAL_SIGNATURE = 'local:hashed-v1';
const REMOTE_COOLDOWN_MS = 60_000;

/**
 * Produces embeddings from the configured provider, transparently falling back
 * to a local hashed embedding so the knowledge base also works without a key.
 */
export class Embedder {
  private remoteDisabledUntil = 0;
  private lastError: string | null = null;

  constructor(
    private readonly provider: LlmProvider,
    private readonly settings: SettingsService,
  ) {}

  private remoteSignature(): string {
    return `remote:${this.settings.get().provider.embeddingModel}`;
  }

  /** Signature the next embed() call is expected to produce. */
  expectedSignature(): string {
    const remoteAvailable = this.provider.configured && Date.now() >= this.remoteDisabledUntil;
    return remoteAvailable ? this.remoteSignature() : LOCAL_SIGNATURE;
  }

  get error(): string | null {
    return this.lastError;
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { vectors: [], signature: this.expectedSignature(), remote: false };
    }
    if (this.provider.configured && Date.now() >= this.remoteDisabledUntil) {
      try {
        const vectors = await this.provider.embed(texts);
        this.lastError = null;
        return { vectors, signature: this.remoteSignature(), remote: true };
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.remoteDisabledUntil = Date.now() + REMOTE_COOLDOWN_MS;
      }
    }
    return {
      vectors: texts.map((t) => localEmbed(t)),
      signature: LOCAL_SIGNATURE,
      remote: false,
    };
  }
}
