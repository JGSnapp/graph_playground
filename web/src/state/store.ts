import type {
  AgentEvent,
  Arrow,
  Artifact,
  Attachment,
  Board,
  ChatMessage,
  ModelInfo,
  PublicSettings,
  Viewport,
} from '@teca/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { runAgent } from '../api/stream';
import { captureBoard } from './capture';

export interface Selection {
  artifactId?: string;
  arrowId?: string;
}

interface RunHandle {
  abort: () => void;
}

export interface HistoryFlags {
  canUndo: boolean;
  canRedo: boolean;
}

interface AppState {
  ready: boolean;
  boards: Board[];
  activeBoardId: string | null;
  history: Record<string, HistoryFlags>;
  messages: Record<string, ChatMessage[]>;
  models: ModelInfo[];
  modelSource: 'api' | 'fallback';
  settings: PublicSettings | null;
  runs: Record<string, RunHandle>;
  selection: Record<string, Selection>;
  connecting: string[];
  error: string | null;
  streamStatus: Record<string, string | null>;

  init: () => Promise<void>;
  refreshModels: (force?: boolean) => Promise<void>;
  reloadSettings: () => Promise<void>;
  saveSettings: (patch: unknown) => Promise<void>;

  addBoard: () => Promise<void>;
  removeBoard: (boardId: string) => Promise<void>;
  selectBoard: (boardId: string) => void;
  patchBoardLocal: (board: Board) => void;
  renameBoard: (boardId: string, title: string) => Promise<void>;
  setBoardModel: (boardId: string, model: string) => Promise<void>;
  setViewport: (boardId: string, viewport: Viewport) => void;
  reloadBoard: (boardId: string) => Promise<void>;
  undo: (boardId: string) => Promise<void>;
  redo: (boardId: string) => Promise<void>;

  select: (boardId: string, selection: Selection) => void;
  applyArtifact: (boardId: string, artifact: Artifact) => void;
  removeArtifactLocal: (boardId: string, artifactId: string) => void;
  applyArrow: (boardId: string, arrow: Arrow) => void;
  removeArrowLocal: (boardId: string, arrowId: string) => void;

  send: (boardId: string, text: string, attachments: Attachment[], model?: string) => Promise<void>;
  stop: (boardId: string) => void;
  clearChat: (boardId: string) => Promise<void>;
  setError: (message: string | null) => void;
}

const upsertBoard = (boards: Board[], board: Board): Board[] => {
  const index = boards.findIndex((b) => b.id === board.id);
  if (index < 0) return [...boards, board];
  const next = boards.slice();
  next[index] = board;
  return next;
};

const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex((i) => i.id === item.id);
  if (index < 0) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
};

/** Applies a local change to one board and marks the board as undoable. */
const editBoard = (
  state: { boards: Board[]; history: Record<string, HistoryFlags> },
  boardId: string,
  edit: (board: Board) => Board,
) => {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) return {};
  return {
    boards: upsertBoard(state.boards, edit(board)),
    history: { ...state.history, [boardId]: { canUndo: true, canRedo: false } },
  };
};

const withMessage = (
  messages: ChatMessage[],
  id: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] => {
  const index = messages.findIndex((m) => m.id === id);
  if (index < 0) return messages;
  const next = messages.slice();
  next[index] = updater(next[index]);
  return next;
};

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  boards: [],
  activeBoardId: null,
  history: {},
  messages: {},
  models: [],
  modelSource: 'fallback',
  settings: null,
  runs: {},
  selection: {},
  connecting: [],
  error: null,
  streamStatus: {},

  init: async () => {
    try {
      const [{ boards }, settings, models] = await Promise.all([
        api.listBoards(),
        api.getSettings(),
        api.models(),
      ]);
      set({
        boards,
        settings,
        models: models.models,
        modelSource: models.source,
        activeBoardId: boards[0]?.id ?? null,
        ready: true,
      });
      if (boards[0]) await get().reloadBoard(boards[0].id);
    } catch (error) {
      set({ ready: true, error: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshModels: async (force = false) => {
    const { models, source } = await api.models(force);
    set({ models, modelSource: source });
  },

  reloadSettings: async () => set({ settings: await api.getSettings() }),

  saveSettings: async (patch) => {
    const settings = await api.updateSettings(patch);
    set({ settings });
    await get().refreshModels(true);
  },

  addBoard: async () => {
    const board = await api.createBoard({ model: get().settings?.provider.defaultModel });
    set((state) => ({
      boards: [...state.boards, board],
      activeBoardId: board.id,
      messages: { ...state.messages, [board.id]: [] },
    }));
  },

  removeBoard: async (boardId) => {
    await api.deleteBoard(boardId);
    set((state) => {
      const boards = state.boards.filter((b) => b.id !== boardId);
      const { [boardId]: _removed, ...messages } = state.messages;
      return {
        boards,
        messages,
        activeBoardId: state.activeBoardId === boardId ? (boards[0]?.id ?? null) : state.activeBoardId,
      };
    });
  },

  selectBoard: (boardId) => {
    set({ activeBoardId: boardId });
    if (!get().messages[boardId]) void get().reloadBoard(boardId);
  },

  patchBoardLocal: (board) => set((state) => ({ boards: upsertBoard(state.boards, board) })),

  renameBoard: async (boardId, title) => {
    const board = await api.patchBoard(boardId, { title });
    get().patchBoardLocal(board);
  },

  setBoardModel: async (boardId, model) => {
    const board = await api.patchBoard(boardId, { model });
    get().patchBoardLocal(board);
  },

  setViewport: (boardId, viewport) => {
    set((state) => ({
      boards: state.boards.map((b) => (b.id === boardId ? { ...b, viewport } : b)),
    }));
    void api.patchBoard(boardId, { viewport }).catch(() => undefined);
  },

  reloadBoard: async (boardId) => {
    const [{ board, history }, { messages }] = await Promise.all([
      api.getBoard(boardId),
      api.messages(boardId),
    ]);
    set((state) => ({
      boards: upsertBoard(state.boards, board),
      history: { ...state.history, [boardId]: history },
      messages: { ...state.messages, [boardId]: messages },
    }));
  },

  undo: async (boardId) => {
    const { board, history } = await api.undo(boardId);
    set((state) => ({
      boards: upsertBoard(state.boards, board),
      history: { ...state.history, [boardId]: history },
    }));
  },

  redo: async (boardId) => {
    const { board, history } = await api.redo(boardId);
    set((state) => ({
      boards: upsertBoard(state.boards, board),
      history: { ...state.history, [boardId]: history },
    }));
  },

  select: (boardId, selection) =>
    set((state) => ({ selection: { ...state.selection, [boardId]: selection } })),

  applyArtifact: (boardId, artifact) =>
    set((state) =>
      editBoard(state, boardId, (board) => ({
        ...board,
        state: { ...board.state, artifacts: upsertById(board.state.artifacts, artifact) },
      })),
    ),

  removeArtifactLocal: (boardId, artifactId) =>
    set((state) =>
      editBoard(state, boardId, (board) => ({
        ...board,
        state: {
          artifacts: board.state.artifacts.filter((a) => a.id !== artifactId),
          arrows: board.state.arrows.filter(
            (a) => a.from.artifactId !== artifactId && a.to.artifactId !== artifactId,
          ),
        },
      })),
    ),

  applyArrow: (boardId, arrow) =>
    set((state) =>
      editBoard(state, boardId, (board) => ({
        ...board,
        state: { ...board.state, arrows: upsertById(board.state.arrows, arrow) },
      })),
    ),

  removeArrowLocal: (boardId, arrowId) =>
    set((state) =>
      editBoard(state, boardId, (board) => ({
        ...board,
        state: { ...board.state, arrows: board.state.arrows.filter((a) => a.id !== arrowId) },
      })),
    ),

  send: async (boardId, text, attachments, model) => {
    if (get().runs[boardId]) return;

    const handleEvent = (event: AgentEvent) => {
      const push = (message: ChatMessage) =>
        set((state) => {
          const list = state.messages[boardId] ?? [];
          const exists = list.some((m) => m.id === message.id);
          return {
            messages: {
              ...state.messages,
              [boardId]: exists
                ? list.map((m) => (m.id === message.id ? message : m))
                : [...list, message],
            },
          };
        });

      switch (event.type) {
        case 'message_start':
        case 'message_end':
          push(event.message);
          break;
        case 'content_delta':
          set((state) => ({
            messages: {
              ...state.messages,
              [boardId]: withMessage(state.messages[boardId] ?? [], event.messageId, (m) => ({
                ...m,
                content: m.content + event.delta,
              })),
            },
          }));
          break;
        case 'reasoning_delta':
          set((state) => ({
            messages: {
              ...state.messages,
              [boardId]: withMessage(state.messages[boardId] ?? [], event.messageId, (m) => ({
                ...m,
                reasoning: (m.reasoning ?? '') + event.delta,
              })),
            },
          }));
          break;
        case 'content_replace':
          set((state) => ({
            messages: {
              ...state.messages,
              [boardId]: withMessage(state.messages[boardId] ?? [], event.messageId, (m) => ({
                ...m,
                content: event.content,
              })),
            },
          }));
          break;
        case 'reasoning_replace':
          set((state) => ({
            messages: {
              ...state.messages,
              [boardId]: withMessage(state.messages[boardId] ?? [], event.messageId, (m) => ({
                ...m,
                reasoning: event.reasoning,
              })),
            },
          }));
          break;
        case 'status':
          set((state) => ({ streamStatus: { ...state.streamStatus, [boardId]: event.message } }));
          break;
        case 'tool_call':
        case 'tool_result':
          set((state) => ({
            messages: {
              ...state.messages,
              [boardId]: withMessage(state.messages[boardId] ?? [], event.messageId, (m) => {
                const calls = m.toolCalls ?? [];
                const index = calls.findIndex((c) => c.id === event.toolCall.id);
                const next = index < 0 ? [...calls, event.toolCall] : calls.slice();
                if (index >= 0) next[index] = event.toolCall;
                return { ...m, toolCalls: next };
              }),
            },
          }));
          break;
        case 'board_updated':
          set((state) => ({
            boards: upsertBoard(state.boards, event.board),
            history: { ...state.history, [boardId]: { canUndo: true, canRedo: false } },
          }));
          break;
        case 'screenshot_request':
          void captureBoard(event.boardId, event.region).then((dataUrl) =>
            api.sendScreenshot(event.requestId, dataUrl).catch(() => undefined),
          );
          break;
        case 'run_end':
          set((state) => ({ streamStatus: { ...state.streamStatus, [boardId]: null } }));
          break;
        case 'error':
          set({ error: event.message });
          break;
        default:
          break;
      }
    };

    const { done, abort } = runAgent({ boardId, text, model, attachments }, handleEvent);
    set((state) => ({ runs: { ...state.runs, [boardId]: { abort } } }));
    try {
      await done;
    } finally {
      set((state) => {
        const { [boardId]: _removed, ...runs } = state.runs;
        return { runs };
      });
      // The board may have changed through tools whose events were missed on abort.
      void get().reloadBoard(boardId).catch(() => undefined);
    }
  },

  stop: (boardId) => {
    get().runs[boardId]?.abort();
  },

  clearChat: async (boardId) => {
    await api.clearMessages(boardId);
    set((state) => ({ messages: { ...state.messages, [boardId]: [] } }));
  },

  setError: (message) => set({ error: message }),
}));