import type { Arrow, Artifact } from './artifacts.js';

export interface BoardState {
  artifacts: Artifact[];
  arrows: Arrow[];
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Board {
  id: string;
  title: string;
  description: string;
  /** Model used by the agent bound to this board; changeable per request. */
  model: string;
  state: BoardState;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  model: string;
  artifactCount: number;
  arrowCount: number;
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: number;
}

export const emptyBoardState = (): BoardState => ({ artifacts: [], arrows: [] });
