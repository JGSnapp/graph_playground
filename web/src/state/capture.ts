import type { Rect } from '@teca/shared';

export type CaptureFn = (region: Rect) => Promise<string | null>;

/**
 * Boards register a rasterizer here so the agent's screenshot tool can reach
 * the live DOM. Kept outside the store because it holds functions, not state.
 */
const registry = new Map<string, CaptureFn>();

export const registerCapture = (boardId: string, fn: CaptureFn): (() => void) => {
  registry.set(boardId, fn);
  return () => {
    if (registry.get(boardId) === fn) registry.delete(boardId);
  };
};

export const captureBoard = async (boardId: string, region: Rect): Promise<string | null> => {
  const fn = registry.get(boardId);
  if (!fn) return null;
  try {
    return await fn(region);
  } catch {
    return null;
  }
};
