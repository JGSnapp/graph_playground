import type { AgentEvent } from '@teca/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/modules/agent/tools/index.js';
import { validateArgs } from '../src/modules/agent/tools/validate.js';
import { contentFrame, finishFrame, makeEnv, sseResponse, toolCallFrame, type TestEnv } from './helpers.js';

const collect = () => {
  const events: AgentEvent[] = [];
  return { events, emit: (event: AgentEvent) => events.push(event) };
};

describe('tool argument validation', () => {
  it('coerces stringified numbers the way models emit them', () => {
    const schema = {
      type: 'object',
      properties: { x: { type: 'number' }, id: { type: 'string' } },
      required: ['x', 'id'],
    };
    const result = validateArgs(schema, { x: '120', id: 'art_1' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ x: 120, id: 'art_1' });
  });

  it('reports missing required fields and bad enums', () => {
    const schema = {
      type: 'object',
      properties: { type: { type: 'string', enum: ['note', 'text'] } },
      required: ['type', 'x'],
    };
    const result = validateArgs(schema, { type: 'video' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/x: required/);
    expect(result.errors.join(' ')).toMatch(/expected one of/);
  });
});

describe('tool registry', () => {
  it('hides knowledge tools when the base is disabled', () => {
    const registry = new ToolRegistry();
    const enabled = (readEnabled: boolean, writeEnabled: boolean) =>
      registry
        .enabled({
          provider: { baseUrl: '', apiKey: '', defaultModel: '', embeddingModel: '' },
          agent: {
            systemPrompt: '',
            maxIterations: 5,
            unlimitedIterations: false,
            providerRetries: 0,
            temperature: 0,
            maxTokens: 8192,
          },
          knowledge: { readEnabled, writeEnabled, topK: 5 },
          skills: { enabled: true },
        })
        .map((tool) => tool.name);

    expect(enabled(true, true)).toEqual(expect.arrayContaining(['kb_search', 'kb_add']));
    expect(enabled(true, false)).toContain('kb_search');
    expect(enabled(true, false)).not.toContain('kb_add');
    expect(enabled(false, false)).not.toContain('kb_search');
  });
});

describe('agent run loop', () => {
  let env: TestEnv;
  const responses: Response[] = [];
  const requests: Array<Record<string, unknown>> = [];

  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as unknown as typeof fetch;

  beforeEach(() => {
    responses.length = 0;
    requests.length = 0;
    env = makeEnv({ fetchImpl, screenshotTimeoutMs: 50 });
    env.ctx.settings.update({
      provider: { apiKey: 'test-key' },
      agent: { providerRetries: 0, unlimitedIterations: false },
    });
  });

  afterEach(async () => {
    await env.dispose();
  });

  it('executes tool calls, mutates the board and streams events', async () => {
    const board = env.ctx.boards.create({ title: 'Схема', model: 'test-model' });
    responses.push(
      sseResponse([
        toolCallFrame(
          0,
          'call_1',
          'artifact_create',
          JSON.stringify({ type: 'note', x: 0, y: 0, props: { text: 'Первый шаг' } }),
        ),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Разместил заметку.'), finishFrame('stop')]),
    );

    const { events, emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'Добавь заметку' },
      emit,
      new AbortController().signal,
    );

    expect(message.content).toBe('Разместил заметку.');
    expect(message.toolCalls?.[0]).toMatchObject({ name: 'artifact_create', status: 'done' });

    const artifacts = env.ctx.boards.get(board.id).state.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].props.text).toBe('Первый шаг');

    const types = events.map((e) => e.type);
    expect(types).toContain('run_start');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('board_updated');
    expect(types.at(-1)).toBe('run_end');

    // The board state is injected into the system prompt of every request.
    const firstSystem = (requests[0].messages as Array<{ role: string; content: string }>)[0];
    expect(firstSystem.role).toBe('system');
    expect(firstSystem.content).toContain('Доска: "Схема"');
    expect(requests[0].model).toBe('test-model');
  });

  it('reports tool failures back to the model instead of aborting the run', async () => {
    const board = env.ctx.boards.create();
    responses.push(
      sseResponse([
        toolCallFrame(0, 'call_1', 'artifact_move', JSON.stringify({ id: 'art_missing', x: 1, y: 2 })),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Не нашёл артефакт.'), finishFrame('stop')]),
    );

    const { events, emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'Подвинь' },
      emit,
      new AbortController().signal,
    );

    expect(message.toolCalls?.[0]).toMatchObject({ status: 'error' });
    expect(message.toolCalls?.[0].error).toMatch(/not found/);
    expect(message.content).toBe('Не нашёл артефакт.');

    const toolMessage = (requests[1].messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'tool',
    );
    expect(toolMessage?.content).toMatch(/Ошибка/);
  });

  it('records a business refusal separately and reports it clearly to the model', async () => {
    const board = env.ctx.boards.create();
    env.ctx.boards.mutate(board.id, (state) => {
      state.artifacts.push({
        id: 'art_existing',
        type: 'note',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        z: 1,
        props: { text: 'existing' },
        createdAt: 0,
        updatedAt: 0,
      });
    });
    responses.push(
      sseResponse([
        toolCallFrame(0, 'call_refused', 'artifact_create', JSON.stringify({ type: 'note', x: 20, y: 20 })),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Выбрал другое место.'), finishFrame('stop')]),
    );

    const { emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'Добавь блок' },
      emit,
      new AbortController().signal,
    );

    expect(message.toolCalls?.[0]).toMatchObject({ status: 'refused' });
    expect(message.toolCalls?.[0].refusalReason).toMatch(/наложится/);
    expect(env.ctx.boards.get(board.id).state.artifacts).toHaveLength(1);
    const toolMessage = (requests[1].messages as Array<{ role: string; content: string }>).find(
      (item) => item.role === 'tool',
    );
    expect(toolMessage?.content).toContain('"status":"refused"');

    const log = env.ctx.runLogs.list(board.id)[0];
    expect(log.refusalStatus).toBe('encountered');
    expect(log.iterations[0]).toMatchObject({ refusalStatus: 'refused' });
    expect(log.iterations[0].toolCalls[0]).toMatchObject({
      status: 'refused',
      refused: true,
      mutated: false,
    });
    expect(log.iterations[0].toolCalls[0].qualityAfter).toEqual(
      log.iterations[0].toolCalls[0].qualityBefore,
    );
  });

  it('falls back to an ascii schema when no client answers a screenshot request', async () => {
    const board = env.ctx.boards.create();
    env.ctx.boards.mutate(board.id, (state) => {
      state.artifacts.push({
        id: 'art_demo',
        type: 'note',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        z: 1,
        props: { text: 'привет' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    responses.push(
      sseResponse([
        toolCallFrame(0, 'call_1', 'board_screenshot', JSON.stringify({ x: -50, y: -50, width: 400, height: 300 })),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Посмотрел.'), finishFrame('stop')]),
    );

    const { events, emit } = collect();
    await env.ctx.agent.run({ boardId: board.id, text: 'Посмотри' }, emit, new AbortController().signal);

    expect(events.some((e) => e.type === 'screenshot_request')).toBe(true);
    const toolResult = events.find(
      (e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result',
    );
    const data = toolResult?.toolCall.result as { captured: boolean; schema: string };
    expect(data.captured).toBe(false);
    expect(data.schema).toContain('art_demo');
  });

  it('delivers a client screenshot to the model as an image message', async () => {
    const board = env.ctx.boards.create();
    responses.push(
      sseResponse([
        toolCallFrame(0, 'call_1', 'board_screenshot', JSON.stringify({ x: 0, y: 0, width: 100, height: 100 })),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Вижу.'), finishFrame('stop')]),
    );

    const emitted: AgentEvent[] = [];
    const emit = (event: AgentEvent) => {
      emitted.push(event);
      if (event.type === 'screenshot_request') {
        env.ctx.screenshots.fulfill(event.requestId, 'data:image/png;base64,AAAA');
      }
    };

    await env.ctx.agent.run({ boardId: board.id, text: 'Скрин' }, emit, new AbortController().signal);

    const imageMessage = (requests[1].messages as Array<{ role: string; content: unknown }>).find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((part: { type: string }) => part.type === 'image_url'),
    );
    expect(imageMessage).toBeDefined();
  });

  it('surfaces provider errors as an error event', async () => {
    const board = env.ctx.boards.create();
    responses.push(new Response('quota exceeded', { status: 429 }));

    const { events, emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'привет' },
      emit,
      new AbortController().signal,
    );

    expect(message.error).toMatch(/429/);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('stops after maxIterations even if the model keeps calling tools', async () => {
    env.ctx.settings.update({ agent: { maxIterations: 2, unlimitedIterations: false } });
    const board = env.ctx.boards.create();
    for (let i = 0; i < 5; i++) {
      responses.push(
        sseResponse([
          toolCallFrame(0, `call_${i}`, 'artifact_create', JSON.stringify({ type: 'note', x: i * 300, y: 0 })),
          finishFrame('tool_calls'),
        ]),
      );
    }

    const { events, emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'Спам' },
      emit,
      new AbortController().signal,
    );
    expect(env.ctx.boards.get(board.id).state.artifacts).toHaveLength(2);
    expect(message.error).toMatch(/Достигнут лимит 2 итераций/);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    const log = env.ctx.runLogs.list(board.id)[0];
    expect(log.terminationReason).toBe('iteration_limit');
    expect(log.iterations).toHaveLength(2);
    expect(log.restoredBestCheckpoint).toBeDefined();
  });

  it('restores the best complete graph when the iteration limit is reached', async () => {
    env.ctx.settings.update({ agent: { maxIterations: 1, unlimitedIterations: false } });
    const board = env.ctx.boards.create();
    env.ctx.boards.mutate(board.id, (state) => {
      state.artifacts.push(
        {
          id: 'art_a', type: 'note', x: 0, y: 0, width: 200, height: 100, z: 1,
          props: {}, createdAt: 0, updatedAt: 0,
        },
        {
          id: 'art_b', type: 'note', x: 400, y: 0, width: 200, height: 100, z: 2,
          props: {}, createdAt: 0, updatedAt: 0,
        },
      );
      state.arrows.push({
        id: 'arr_keep',
        from: { artifactId: 'art_a', side: 'right' },
        to: { artifactId: 'art_b', side: 'left' },
        bends: [],
        style: {},
        createdAt: 0,
        updatedAt: 0,
      });
    });
    responses.push(
      sseResponse([
        toolCallFrame(0, 'call_delete', 'arrow_delete', JSON.stringify({ id: 'arr_keep' })),
        finishFrame('tool_calls'),
      ]),
    );

    const { emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'Переделай граф' },
      emit,
      new AbortController().signal,
    );

    expect(message.error).toMatch(/восстановлен лучший полный снимок/);
    expect(env.ctx.boards.get(board.id).state.arrows.map((arrow) => arrow.id)).toEqual(['arr_keep']);
    const log = env.ctx.runLogs.list(board.id)[0];
    expect(log.bestCheckpoint).toMatchObject({ iteration: 0 });
    expect(log.restoredBestCheckpoint).toMatchObject({
      checkpointId: log.bestCheckpoint.checkpointId,
      iteration: 0,
    });
  });

  it('retries mid-stream provider errors and then succeeds', async () => {
    env.ctx.settings.update({ agent: { providerRetries: 2 } });
    const board = env.ctx.boards.create();
    responses.push(
      new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"част"}}]}\n\n' +
                  'data: {"error":{"message":"Provider unavailable mid-stream; client should retry"}}\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
      sseResponse([contentFrame('Готово после повтора.'), finishFrame('stop')]),
    );

    const { events, emit } = collect();
    const message = await env.ctx.agent.run(
      { boardId: board.id, text: 'привет' },
      emit,
      new AbortController().signal,
    );

    expect(message.error).toBeUndefined();
    expect(message.content).toBe('Готово после повтора.');
    expect(events.some((e) => e.type === 'status')).toBe(true);
    expect(events.some((e) => e.type === 'content_replace')).toBe(true);
    expect(requests).toHaveLength(2);
  });
});
