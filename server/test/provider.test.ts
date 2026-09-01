import { describe, expect, it, vi } from 'vitest';
import {
  allowsSamplingParams,
  buildChatBody,
  completionLimitFields,
  flattenContent,
  mergeToolCalls,
  toWireMessages,
  usesCompletionTokenLimit,
} from '../src/modules/llm/provider.js';
import { stringifyToolResult } from '../src/modules/agent/agent.service.js';
import { finishFrame, makeEnv, sseResponse, toolCallFrame } from './helpers.js';

describe('flattenContent', () => {
  it('joins string and part-array payloads', () => {
    expect(flattenContent('hi')).toBe('hi');
    expect(flattenContent([{ type: 'text', text: 'a' }, { text: 'b' }])).toBe('ab');
    expect(flattenContent(null)).toBe('');
  });
});

describe('completionLimitFields', () => {
  it('caps ordinary models with max_tokens and GPT-5 with both fields', () => {
    expect(usesCompletionTokenLimit('deepseek-v4-flash')).toBe(false);
    expect(completionLimitFields('deepseek-v4-flash', 8192)).toEqual({ max_tokens: 8192 });
    expect(usesCompletionTokenLimit('gpt-5.6-sol')).toBe(true);
    expect(completionLimitFields('gpt-5.6-sol', 8192)).toEqual({
      max_tokens: 8192,
      max_completion_tokens: 8192,
    });
  });
});

describe('allowsSamplingParams', () => {
  it('rejects GPT-5+ and o-series, keeps ordinary chat models', () => {
    expect(allowsSamplingParams('gpt-5.6-terra')).toBe(false);
    expect(allowsSamplingParams('gpt-5.6-luna')).toBe(false);
    expect(allowsSamplingParams('openai/gpt-5.4')).toBe(false);
    expect(allowsSamplingParams('o3-mini')).toBe(false);
    expect(allowsSamplingParams('deepseek-v4-flash')).toBe(true);
    expect(allowsSamplingParams('claude-sonnet-5')).toBe(false);
    expect(allowsSamplingParams('claude-opus-5')).toBe(false);
    expect(allowsSamplingParams('kimi-k3')).toBe(false);
    expect(allowsSamplingParams('claude-sonnet-4-6')).toBe(true);
  });
});

describe('LlmProvider.chat', () => {
  it('reads content from a normal SSE stream', async () => {
    const fetchImpl = vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });

    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const turn = await env.ctx.provider.chat({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
      });
      expect(turn.content).toBe('OK');
      const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [unknown, { body?: string }])?.[1]?.body)) as {
        temperature?: number;
        max_tokens?: number;
      };
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(8192);
      expect(body).not.toHaveProperty('max_completion_tokens');
    } finally {
      await env.dispose();
    }
  });

  it('omits temperature for GPT-5.6 models', async () => {
    const fetchImpl = vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });

    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      await env.ctx.provider.chat({
        model: 'gpt-5.6-terra',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
      });
      const body = JSON.parse(
        String((fetchImpl.mock.calls[0] as unknown as [unknown, { body?: string }])?.[1]?.body),
      ) as Record<string, unknown>;
      expect(body).not.toHaveProperty('temperature');
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.max_tokens).toBe(8192);
      expect(body.max_completion_tokens).toBe(8192);
    } finally {
      await env.dispose();
    }
  });

  it('throws when the SSE body has no data frames', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    ) as unknown as typeof fetch;

    const env = makeEnv({ fetchImpl });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      await expect(
        env.ctx.provider.chat({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/empty stream/i);
    } finally {
      await env.dispose();
    }
  });

  it('falls back to a JSON body when the gateway ignores stream:true', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }] },
        { headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const env = makeEnv({ fetchImpl });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const turn = await env.ctx.provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(turn.content).toBe('pong');
    } finally {
      await env.dispose();
    }
  });
});

describe('agent empty-response surfacing', () => {
  it('emits an error when the model returns nothing', async () => {
    const fetchImpl = vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch;

    const env = makeEnv({ fetchImpl });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const board = env.ctx.boards.create();
      const events: Array<{ type: string; message?: string }> = [];
      const message = await env.ctx.agent.run(
        { boardId: board.id, text: 'ping' },
        (event) => events.push(event as { type: string; message?: string }),
        new AbortController().signal,
      );
      expect(message.error).toMatch(/пустой ответ/i);
      expect(events.some((e) => e.type === 'error')).toBe(true);
    } finally {
      await env.dispose();
    }
  });
});

describe('chat payload', () => {
  it('omits tool message name and keeps assistant content null when calling tools', () => {
    const messages = toWireMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'artifact_move', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'artifact_move', content: '{"ok":true}' },
    ]);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'artifact_move', arguments: '{}' } }],
    });
    expect(messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"ok":true}',
    });
    expect(JSON.parse(JSON.stringify(buildChatBody({ model: 'deepseek-v4-flash', messages: [] })))).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: true,
    });
  });

  it('does not duplicate tool calls when the stream has both deltas and a final message', () => {
    const streamed = new Map([
      [
        0,
        {
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'artifact_create', arguments: '{"x":1}' },
        },
      ],
    ]);
    const fromMessage = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'artifact_create', arguments: '{"x":1}' },
      },
    ];
    expect(mergeToolCalls(streamed, fromMessage)).toHaveLength(1);
  });

  it('keeps truncated tool results as parseable JSON', () => {
    const huge = { text: 'я'.repeat(20_000) };
    const raw = stringifyToolResult(huge, 800);
    const parsed = JSON.parse(raw) as { truncated: boolean; preview: string };
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview.length).toBeGreaterThan(0);
  });
});

describe('LlmProvider.chat tool-call stream', () => {
  it('uses streamed deltas when the terminal chunk also lists the same calls', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        toolCallFrame(0, 'call_1', 'artifact_create', '{"x":0,"y":0,"type":"note"}'),
        {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'artifact_create', arguments: '{"x":0,"y":0,"type":"note"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        finishFrame('tool_calls'),
      ]),
    );

    const env = makeEnv({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      env.ctx.settings.update({ provider: { apiKey: 'test' } });
      const turn = await env.ctx.provider.chat({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]?.id).toBe('call_1');
    } finally {
      await env.dispose();
    }
  });
});
