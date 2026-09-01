import { describe, expect, it, vi } from 'vitest';
import { addUsage, emptyUsage, readUsage } from '../src/modules/llm/types.js';
import { contentFrame, finishFrame, makeEnv, sseResponse, toolCallFrame } from './helpers.js';

const stream = (frames: unknown[]) => sseResponse(frames);

describe('readUsage', () => {
  it('reads the OpenAI shape', () => {
    expect(readUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cachedTokens: undefined,
      reasoningTokens: undefined,
    });
  });

  it('reads the Anthropic-style field names and derives the total', () => {
    expect(readUsage({ input_tokens: 10, output_tokens: 4 })).toMatchObject({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });
  });

  it('picks up cached and reasoning tokens when reported', () => {
    const usage = readUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 20 },
    });
    expect(usage?.cachedTokens).toBe(80);
    expect(usage?.reasoningTokens).toBe(20);
  });

  it('returns null rather than a misleading zero', () => {
    expect(readUsage(undefined)).toBeNull();
    expect(readUsage({})).toBeNull();
    expect(readUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toBeNull();
  });

  it('adds up without inventing optional fields', () => {
    const sum = addUsage(
      addUsage(emptyUsage(), { promptTokens: 10, completionTokens: 2, totalTokens: 12 }),
      { promptTokens: 5, completionTokens: 3, totalTokens: 8, cachedTokens: 4 },
    );
    expect(sum).toEqual({
      promptTokens: 15,
      completionTokens: 5,
      totalTokens: 20,
      cachedTokens: 4,
      reasoningTokens: undefined,
    });
  });
});

describe('provider usage', () => {
  it('asks the gateway to include usage on the stream', async () => {
    const fetchImpl = vi.fn(async () => stream([contentFrame('ok'), finishFrame('stop')]));
    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      await env.ctx.provider.chat({ model: 'deepseek-v4-flash', messages: [] });
      const body = JSON.parse(
        String((fetchImpl.mock.calls[0] as unknown as [unknown, { body?: string }])?.[1]?.body),
      ) as { stream_options?: { include_usage?: boolean } };
      expect(body.stream_options?.include_usage).toBe(true);
    } finally {
      await env.dispose();
    }
  });

  it('reads usage from the final chunk, which carries no choices', async () => {
    const fetchImpl = vi.fn(async () =>
      stream([
        contentFrame('ok'),
        finishFrame('stop'),
        { choices: [], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } },
      ]),
    );
    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const turn = await env.ctx.provider.chat({ model: 'deepseek-v4-flash', messages: [] });
      expect(turn.usage).toMatchObject({
        promptTokens: 900,
        completionTokens: 120,
        totalTokens: 1020,
      });
    } finally {
      await env.dispose();
    }
  });

  it('leaves usage absent when the provider reports none', async () => {
    const fetchImpl = vi.fn(async () => stream([contentFrame('ok'), finishFrame('stop')]));
    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const turn = await env.ctx.provider.chat({ model: 'deepseek-v4-flash', messages: [] });
      expect(turn.usage).toBeUndefined();
    } finally {
      await env.dispose();
    }
  });
});

describe('run usage accounting', () => {
  it('sums tokens over every iteration of a run and reports them on the message', async () => {
    const usageFrame = (prompt: number, completion: number) => ({
      choices: [],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    });

    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return stream([
          toolCallFrame(0, 'call_1', 'board_quality', '{}'),
          finishFrame('tool_calls'),
          usageFrame(1200, 40),
        ]);
      }
      return stream([contentFrame('готово'), finishFrame('stop'), usageFrame(1500, 60)]);
    });

    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const board = env.ctx.boards.create();
      const message = await env.ctx.agent.run(
        { boardId: board.id, text: 'посчитай качество' },
        () => undefined,
        new AbortController().signal,
      );

      expect(message.usage).toMatchObject({
        promptTokens: 2700,
        completionTokens: 100,
        totalTokens: 2800,
        calls: 2,
        callsWithoutUsage: 0,
      });

      const run = env.ctx.runLogs.list(board.id)[0];
      expect(run.usage).toMatchObject({ totalTokens: 2800, calls: 2 });
      // Per-iteration numbers make an expensive step findable, not just the total.
      expect(run.iterations[0].usage).toMatchObject({ promptTokens: 1200, completionTokens: 40 });
      expect(run.iterations[1].usage).toMatchObject({ promptTokens: 1500, completionTokens: 60 });
    } finally {
      await env.dispose();
    }
  });

  it('counts unreported calls instead of pretending the run was free', async () => {
    const fetchImpl = vi.fn(async () => stream([contentFrame('готово'), finishFrame('stop')]));
    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const board = env.ctx.boards.create();
      const message = await env.ctx.agent.run(
        { boardId: board.id, text: 'привет' },
        () => undefined,
        new AbortController().signal,
      );

      expect(message.usage).toBeUndefined();
      const run = env.ctx.runLogs.list(board.id)[0];
      expect(run.usage).toMatchObject({ calls: 0, callsWithoutUsage: 1, totalTokens: 0 });
    } finally {
      await env.dispose();
    }
  });
});
