import type { Board, BoardState, BoardSummary, Viewport } from '@teca/shared';
import { emptyBoardState } from '@teca/shared';
import path from 'node:path';
import { notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { JsonStore } from '../../core/store.js';

interface BoardRecord {
  board: Board;
  past: BoardState[];
  future: BoardState[];
}

interface BoardsData {
  boards: BoardRecord[];
}

const HISTORY_LIMIT = 60;

export interface CreateBoardInput {
  title?: string;
  description?: string;
  model?: string;
}

export class BoardsService {
  private readonly store: JsonStore<BoardsData>;
  private readonly listeners = new Set<(board: Board) => void>();
  /** Last layout cost per board, so the agent can be told whether it improved. */
  private readonly qualityMemo = new Map<string, number>();

  constructor(
    dataDir: string,
    private readonly defaultModel: () => string,
  ) {
    this.store = new JsonStore<BoardsData>(path.join(dataDir, 'boards.json'), () => ({
      boards: [],
    }));
  }

  onUpdate(listener: (board: Board) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(board: Board): void {
    for (const listener of this.listeners) listener(board);
  }

  private record(id: string): BoardRecord {
    const record = this.store.get().boards.find((r) => r.board.id === id);
    if (!record) throw notFound(`Board ${id}`);
    return record;
  }

  private summarize(record: BoardRecord): BoardSummary {
    const { board, past, future } = record;
    return {
      id: board.id,
      title: board.title,
      description: board.description,
      model: board.model,
      artifactCount: board.state.artifacts.length,
      arrowCount: board.state.arrows.length,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      updatedAt: board.updatedAt,
    };
  }

  list(): BoardSummary[] {
    return this.store.get().boards.map((r) => this.summarize(r));
  }

  listBoards(): Board[] {
    return this.store.get().boards.map((r) => r.board);
  }

  get(id: string): Board {
    return this.record(id).board;
  }

  /** A complete, detached checkpoint of the graph (nodes and arrows together). */
  snapshot(id: string): BoardState {
    return structuredClone(this.record(id).board.state);
  }

  /**
   * Restores a complete checkpoint as one undoable transaction. Partial
   * inverse operations are intentionally avoided: graph consistency is only
   * guaranteed when artifacts and arrows are restored together.
   */
  restoreState(id: string, state: BoardState): Board {
    const record = this.record(id);
    record.past.push(structuredClone(record.board.state));
    if (record.past.length > HISTORY_LIMIT) record.past.shift();
    record.future = [];
    record.board.state = structuredClone(state);
    record.board.updatedAt = Date.now();
    this.store.update(() => undefined);
    this.emit(record.board);
    return record.board;
  }

  history(id: string): { canUndo: boolean; canRedo: boolean } {
    const record = this.record(id);
    return { canUndo: record.past.length > 0, canRedo: record.future.length > 0 };
  }

  create(input: CreateBoardInput = {}): Board {
    const now = Date.now();
    const count = this.store.get().boards.length;
    const board: Board = {
      id: newId('brd'),
      title: input.title?.trim() || `Доска ${count + 1}`,
      description: input.description ?? '',
      model: input.model || this.defaultModel(),
      state: emptyBoardState(),
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: now,
      updatedAt: now,
    };
    this.store.update((data) => {
      data.boards.push({ board, past: [], future: [] });
    });
    this.emit(board);
    return board;
  }

  updateMeta(
    id: string,
    patch: { title?: string; description?: string; model?: string; viewport?: Viewport },
  ): Board {
    const record = this.record(id);
    if (patch.title != null) record.board.title = patch.title;
    if (patch.description != null) record.board.description = patch.description;
    if (patch.model) record.board.model = patch.model;
    // The viewport is a UI preference, so it is not part of undo history.
    if (patch.viewport) record.board.viewport = patch.viewport;
    record.board.updatedAt = Date.now();
    this.store.update(() => undefined);
    this.emit(record.board);
    return record.board;
  }

  remove(id: string): void {
    this.store.update((data) => {
      const index = data.boards.findIndex((r) => r.board.id === id);
      if (index < 0) throw notFound(`Board ${id}`);
      data.boards.splice(index, 1);
    });
  }

  /**
   * Applies a mutation as one undoable transaction. Every agent tool call and
   * every finished user gesture goes through here.
   */
  mutate<R>(id: string, mutator: (state: BoardState, board: Board) => R): R {
    const record = this.record(id);
    const snapshot = structuredClone(record.board.state);
    let result: R;
    try {
      result = mutator(record.board.state, record.board);
    } catch (error) {
      // Roll back partial mutations so a failed tool call never corrupts a board.
      record.board.state = snapshot;
      throw error;
    }
    record.past.push(snapshot);
    if (record.past.length > HISTORY_LIMIT) record.past.shift();
    record.future = [];
    record.board.updatedAt = Date.now();
    this.store.update(() => undefined);
    this.emit(record.board);
    return result;
  }

  /** Read-only access without touching history. */
  read<R>(id: string, reader: (state: BoardState, board: Board) => R): R {
    const record = this.record(id);
    return reader(record.board.state, record.board);
  }

  previousQuality(id: string): number | null {
    return this.qualityMemo.get(id) ?? null;
  }

  rememberQuality(id: string, cost: number): void {
    this.qualityMemo.set(id, cost);
  }

  undo(id: string): Board {
    const record = this.record(id);
    const previous = record.past.pop();
    if (previous) {
      record.future.push(structuredClone(record.board.state));
      record.board.state = previous;
      record.board.updatedAt = Date.now();
      this.store.update(() => undefined);
      this.emit(record.board);
    }
    return record.board;
  }

  redo(id: string): Board {
    const record = this.record(id);
    const next = record.future.pop();
    if (next) {
      record.past.push(structuredClone(record.board.state));
      record.board.state = next;
      record.board.updatedAt = Date.now();
      this.store.update(() => undefined);
      this.emit(record.board);
    }
    return record.board;
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
