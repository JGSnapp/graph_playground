import type { ChatMessage } from '@teca/shared';
import path from 'node:path';
import { JsonStore } from '../../core/store.js';

interface ChatsData {
  messages: ChatMessage[];
}

const HISTORY_LIMIT_PER_BOARD = 400;

/** Per-board conversation log; each board has its own agent thread. */
export class ChatsService {
  private readonly store: JsonStore<ChatsData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<ChatsData>(path.join(dataDir, 'chats.json'), () => ({
      messages: [],
    }));
  }

  list(boardId: string): ChatMessage[] {
    return this.store.get().messages.filter((m) => m.boardId === boardId);
  }

  append(message: ChatMessage): ChatMessage {
    this.store.update((data) => {
      data.messages.push(message);
      const forBoard = data.messages.filter((m) => m.boardId === message.boardId);
      if (forBoard.length > HISTORY_LIMIT_PER_BOARD) {
        const excess = new Set(
          forBoard.slice(0, forBoard.length - HISTORY_LIMIT_PER_BOARD).map((m) => m.id),
        );
        data.messages = data.messages.filter((m) => !excess.has(m.id));
      }
    });
    return message;
  }

  /** Messages are mutated in place while streaming; this only persists them. */
  touch(): void {
    this.store.update(() => undefined);
  }

  clear(boardId: string): void {
    this.store.update((data) => {
      data.messages = data.messages.filter((m) => m.boardId !== boardId);
    });
  }

  removeForBoard(boardId: string): void {
    this.clear(boardId);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
