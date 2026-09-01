import type { AgentEvent, Rect } from '@teca/shared';
import { newId } from '../../core/ids.js';

interface Pending {
  resolve: (dataUrl: string | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Real pixels only exist in the browser, so `board_screenshot` asks the
 * connected client to rasterize a region and post it back. If nobody answers in
 * time the agent falls back to the vector/ASCII schema.
 */
export class ScreenshotBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = 12_000) {}

  request(
    boardId: string,
    region: Rect,
    emit: (event: AgentEvent) => void,
  ): Promise<string | null> {
    const requestId = newId('shot');
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      emit({ type: 'screenshot_request', requestId, boardId, region });
    });
  }

  fulfill(requestId: string, dataUrl: string | null): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(dataUrl);
    return true;
  }

  get size(): number {
    return this.pending.size;
  }
}
