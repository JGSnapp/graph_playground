import type { AgentEvent, Board } from '@teca/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/state/store';

const board = (overrides: Partial<Board> = {}): Board => ({
  id: 'brd_1',
  title: 'Доска 1',
  description: '',
  model: 'gpt-5.6-terra',
  state: { artifacts: [], arrows: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const sse = (events: AgentEvent[]): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
};

const withArtifact = board({
  state: {
    artifacts: [
      {
        id: 'art_1',
        type: 'note',
        x: 0,
        y: 0,
        width: 240,
        height: 180,
        z: 1,
        props: { text: 'привет' },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    arrows: [],
  },
});

describe('app store', () => {
  let streamEvents: AgentEvent[] = [];

  beforeEach(() => {
    useStore.setState({
      ready: false,
      boards: [],
      activeBoardId: null,
      history: {},
      messages: {},
      models: [],
      settings: null,
      runs: {},
      selection: {},
      error: null,
      streamStatus: {},
    });

    streamEvents = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/boards') && init?.method !== 'POST') {
          return Response.json({ boards: [board()], summaries: [] });
        }
        if (url.endsWith('/api/settings')) {
          return Response.json({
            provider: { baseUrl: '', defaultModel: 'gpt-5.6-terra', embeddingModel: '', apiKeySet: false },
            agent: {
              systemPrompt: '',
              maxIterations: 12,
              unlimitedIterations: false,
              providerRetries: 3,
              temperature: 0.3,
              maxTokens: 8192,
            },
            knowledge: { readEnabled: true, writeEnabled: true, topK: 5 },
          });
        }
        if (url.includes('/api/models')) {
          return Response.json({ models: [{ id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }], source: 'api' });
        }
        if (url.endsWith('/messages')) return Response.json({ messages: [] });
        if (url.endsWith('/chat')) return sse(streamEvents);
        if (url.includes('/api/boards/brd_1')) {
          return Response.json({
            board: useStore.getState().boards[0] ?? board(),
            history: { canUndo: false, canRedo: false },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads boards, settings and models on init', async () => {
    await useStore.getState().init();
    const state = useStore.getState();
    expect(state.ready).toBe(true);
    expect(state.boards).toHaveLength(1);
    expect(state.activeBoardId).toBe('brd_1');
    expect(state.models[0].label).toBe('GPT-5.6 Terra');
  });

  it('assembles a streamed answer from deltas, tool calls and board updates', async () => {
    await useStore.getState().init();

    const assistant = {
      id: 'msg_a',
      boardId: 'brd_1',
      role: 'assistant' as const,
      content: '',
      toolCalls: [],
      createdAt: 0,
    };
    streamEvents = [
      { type: 'run_start', runId: 'run_1', boardId: 'brd_1', model: 'gpt-5.6-terra' },
      {
        type: 'message_end',
        message: { id: 'msg_u', boardId: 'brd_1', role: 'user', content: 'Добавь заметку', createdAt: 0 },
      },
      { type: 'message_start', message: assistant },
      {
        type: 'tool_call',
        messageId: 'msg_a',
        toolCall: { id: 'c1', name: 'artifact_create', args: { type: 'note' }, status: 'running', startedAt: 0 },
      },
      { type: 'board_updated', board: withArtifact },
      {
        type: 'tool_result',
        messageId: 'msg_a',
        toolCall: {
          id: 'c1',
          name: 'artifact_create',
          args: { type: 'note' },
          status: 'done',
          result: { id: 'art_1' },
          startedAt: 0,
          finishedAt: 5,
        },
      },
      { type: 'content_delta', messageId: 'msg_a', delta: 'Готово' },
      { type: 'content_delta', messageId: 'msg_a', delta: ', заметка на доске.' },
      { type: 'run_end', runId: 'run_1' },
    ];

    await useStore.getState().send('brd_1', 'Добавь заметку', []);

    const state = useStore.getState();
    const messages = state.messages.brd_1;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toBe('Готово, заметка на доске.');
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls?.[0].status).toBe('done');
    expect(state.boards[0].state.artifacts).toHaveLength(1);
    // A tool mutated the board, so undo must become available immediately.
    expect(state.history.brd_1).toEqual({ canUndo: true, canRedo: false });
    expect(state.runs.brd_1).toBeUndefined();
  });

  it('surfaces stream errors and still clears the running flag', async () => {
    await useStore.getState().init();
    streamEvents = [{ type: 'error', message: 'нет ключа API' }];

    await useStore.getState().send('brd_1', 'привет', []);

    expect(useStore.getState().error).toBe('нет ключа API');
    expect(useStore.getState().runs.brd_1).toBeUndefined();
  });

  it('ignores a second run for a board that is already streaming', async () => {
    await useStore.getState().init();
    useStore.setState({ runs: { brd_1: { abort: vi.fn() } } });
    const before = useStore.getState().messages.brd_1?.length ?? 0;

    await useStore.getState().send('brd_1', 'повтор', []);

    expect(useStore.getState().messages.brd_1?.length ?? 0).toBe(before);
  });
});
