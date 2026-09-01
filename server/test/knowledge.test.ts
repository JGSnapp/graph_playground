import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEnv, type TestEnv } from './helpers.js';

describe('knowledge base', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(async () => {
    await env.dispose();
  });

  it('seeds anime and pop-culture entries on first run', () => {
    const entries = env.ctx.knowledge.list();
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.every((e) => e.source === 'seed')).toBe(true);
    expect(entries.map((e) => e.title)).toContain('Studio Ghibli');
  });

  it('finds the right seed entry by meaning, not exact wording', async () => {
    const hits = await env.ctx.knowledge.search('какая студия сняла Унесённые призраками', 3);
    expect(hits[0].title).toBe('Studio Ghibli');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('combines vector and lexical signals in the hybrid score', async () => {
    const [hit] = await env.ctx.knowledge.search('меха сериал Евангелион', 1);
    expect(hit.title).toBe('Neon Genesis Evangelion');
    expect(hit.vectorScore).toBeGreaterThan(0);
    expect(hit.lexicalScore).toBeGreaterThan(0);
  });

  it('indexes newly added entries so they become searchable', async () => {
    await env.ctx.knowledge.add({
      title: 'Тест: Сейлор Мун',
      text: 'Sailor Moon — махо-сёдзё аниме Наоко Такэути про воинов в матросках.',
      tags: ['аниме', 'сёдзё'],
      source: 'agent',
    });
    const hits = await env.ctx.knowledge.search('махо-сёдзё воины в матросках', 3);
    expect(hits[0].title).toBe('Тест: Сейлор Мун');
  });

  it('returns nothing for an empty query and reports local embeddings', async () => {
    expect(await env.ctx.knowledge.search('   ')).toEqual([]);
    const stats = env.ctx.knowledge.stats();
    expect(stats.remoteEmbeddings).toBe(false);
    expect(stats.entries).toBeGreaterThan(0);
  });

  it('uses provider embeddings when a key is configured', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(input).endsWith('/embeddings')) return new Response('not found', { status: 404 });
      const { input: texts } = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({
        data: texts.map((text, index) => ({ index, embedding: [1, text.length / 100, 0, 0] })),
      });
    }) as unknown as typeof fetch;

    const remote = makeEnv({ fetchImpl });
    try {
      remote.ctx.settings.update({ provider: { apiKey: 'test-key' } });
      const entry = await remote.ctx.knowledge.add({ title: 'Пример', text: 'Текст' });
      expect(entry.title).toBe('Пример');
      expect(remote.ctx.knowledge.stats().remoteEmbeddings).toBe(true);
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      await remote.dispose();
    }
  });

  it('falls back to local embeddings when the provider fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const broken = makeEnv({ fetchImpl });
    try {
      broken.ctx.settings.update({ provider: { apiKey: 'test-key' } });
      const hits = await broken.ctx.knowledge.search('Cowboy Bebop джаз', 2);
      expect(hits[0].title).toBe('Cowboy Bebop');
      expect(broken.ctx.knowledge.stats().remoteEmbeddings).toBe(false);
    } finally {
      await broken.dispose();
    }
  });
});
