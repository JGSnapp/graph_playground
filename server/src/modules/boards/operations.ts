import type {
  AnchorSide,
  Arrow,
  ArrowRouting,
  ArrowStyle,
  Artifact,
  ArtifactProps,
  ArtifactType,
  BoardState,
  Rect,
  Vec2,
} from '@teca/shared';
import { rectsIntersect } from '@teca/shared';
import { badRequest, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { blueprintFor } from './artifact.defaults.js';

export interface CreateArtifactInput {
  type: ArtifactType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  props?: ArtifactProps;
}

export interface UpdateArtifactInput {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  props?: ArtifactProps;
  /** Replace props entirely instead of merging. */
  replaceProps?: boolean;
}

export interface CreateArrowInput {
  fromId: string;
  toId: string;
  fromSide?: AnchorSide;
  toSide?: AnchorSide;
  /** Port position along the side, 0..1. Omit to let the board distribute it. */
  fromOffset?: number | null;
  toOffset?: number | null;
  bends?: Vec2[];
  routing?: ArrowRouting;
  label?: string;
  style?: ArrowStyle;
}

const normalizeOffset = (value: number | null | undefined): number | undefined => {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
};

const MIN_SIZE = 24;

const findArtifact = (state: BoardState, id: string): Artifact => {
  const artifact = state.artifacts.find((a) => a.id === id);
  if (!artifact) throw notFound(`Artifact ${id}`);
  return artifact;
};

const findArrow = (state: BoardState, id: string): Arrow => {
  const arrow = state.arrows.find((a) => a.id === id);
  if (!arrow) throw notFound(`Arrow ${id}`);
  return arrow;
};

export const createArtifact = (state: BoardState, input: CreateArtifactInput): Artifact => {
  const blueprint = blueprintFor(input.type);
  const now = Date.now();
  const artifact: Artifact = {
    id: newId('art'),
    type: input.type,
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.max(MIN_SIZE, Math.round(input.width ?? blueprint.width)),
    height: Math.max(MIN_SIZE, Math.round(input.height ?? blueprint.height)),
    z: state.artifacts.reduce((max, a) => Math.max(max, a.z), 0) + 1,
    rotation: input.rotation ?? 0,
    props: { ...blueprint.props, ...(input.props ?? {}) },
    createdAt: now,
    updatedAt: now,
  };
  state.artifacts.push(artifact);
  return artifact;
};

export interface UpdateArtifactResult {
  artifact: Artifact;
  /** Auto-routed arrows whose polyline was invalidated by the move. */
  arrowsReset: number;
}

/**
 * Auto-routed bends are absolute world coordinates built for one particular
 * arrangement, so moving or resizing a node turns them into garbage that would
 * render as a detour across the board. Bends placed by hand are left alone:
 * the router owns its routes, everyone else owns theirs.
 */
const dropRoutedBends = (state: BoardState, artifactId: string): number => {
  let reset = 0;
  for (const arrow of state.arrows) {
    const touches =
      arrow.from.artifactId === artifactId || arrow.to.artifactId === artifactId;
    if (!touches || arrow.routing !== 'orthogonal' || arrow.bends.length === 0) continue;
    arrow.bends = [];
    arrow.updatedAt = Date.now();
    reset++;
  }
  return reset;
};

export const updateArtifact = (
  state: BoardState,
  id: string,
  patch: UpdateArtifactInput,
): UpdateArtifactResult => {
  const artifact = findArtifact(state, id);
  const moved =
    (patch.x != null && Math.round(patch.x) !== artifact.x) ||
    (patch.y != null && Math.round(patch.y) !== artifact.y) ||
    (patch.width != null && Math.round(patch.width) !== artifact.width) ||
    (patch.height != null && Math.round(patch.height) !== artifact.height);

  if (patch.x != null) artifact.x = Math.round(patch.x);
  if (patch.y != null) artifact.y = Math.round(patch.y);
  if (patch.width != null) artifact.width = Math.max(MIN_SIZE, Math.round(patch.width));
  if (patch.height != null) artifact.height = Math.max(MIN_SIZE, Math.round(patch.height));
  if (patch.rotation != null) artifact.rotation = patch.rotation;
  if (patch.props) {
    artifact.props = patch.replaceProps ? { ...patch.props } : { ...artifact.props, ...patch.props };
  }
  artifact.updatedAt = Date.now();
  return { artifact, arrowsReset: moved ? dropRoutedBends(state, id) : 0 };
};

export const bringToFront = (state: BoardState, id: string): Artifact => {
  const artifact = findArtifact(state, id);
  artifact.z = state.artifacts.reduce((max, a) => Math.max(max, a.z), 0) + 1;
  return artifact;
};

export const deleteArtifact = (state: BoardState, id: string): { arrowsRemoved: number } => {
  const index = state.artifacts.findIndex((a) => a.id === id);
  if (index < 0) throw notFound(`Artifact ${id}`);
  state.artifacts.splice(index, 1);
  const before = state.arrows.length;
  state.arrows = state.arrows.filter(
    (arrow) => arrow.from.artifactId !== id && arrow.to.artifactId !== id,
  );
  return { arrowsRemoved: before - state.arrows.length };
};

export const createArrow = (state: BoardState, input: CreateArrowInput): Arrow => {
  findArtifact(state, input.fromId);
  findArtifact(state, input.toId);
  if (input.fromId === input.toId) throw badRequest('Arrow endpoints must differ');
  const now = Date.now();
  const arrow: Arrow = {
    id: newId('arr'),
    from: {
      artifactId: input.fromId,
      side: input.fromSide ?? 'auto',
      offset: normalizeOffset(input.fromOffset),
    },
    to: {
      artifactId: input.toId,
      side: input.toSide ?? 'auto',
      offset: normalizeOffset(input.toOffset),
    },
    bends: (input.bends ?? []).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
    routing: input.routing,
    label: input.label,
    style: input.style ?? {},
    createdAt: now,
    updatedAt: now,
  };
  state.arrows.push(arrow);
  return arrow;
};

export interface UpdateArrowInput {
  fromSide?: AnchorSide;
  toSide?: AnchorSide;
  /** 0..1 pins the port; null hands it back to automatic distribution. */
  fromOffset?: number | null;
  toOffset?: number | null;
  label?: string;
  style?: ArrowStyle;
  bends?: Vec2[];
  routing?: ArrowRouting;
}

export const updateArrow = (state: BoardState, id: string, patch: UpdateArrowInput): Arrow => {
  const arrow = findArrow(state, id);
  const portsMoved =
    (patch.fromSide != null && patch.fromSide !== arrow.from.side) ||
    (patch.toSide != null && patch.toSide !== arrow.to.side) ||
    (patch.fromOffset !== undefined && patch.fromOffset !== (arrow.from.offset ?? null)) ||
    (patch.toOffset !== undefined && patch.toOffset !== (arrow.to.offset ?? null));

  if (patch.fromSide) arrow.from.side = patch.fromSide;
  if (patch.toSide) arrow.to.side = patch.toSide;
  if (patch.fromOffset !== undefined) arrow.from.offset = normalizeOffset(patch.fromOffset);
  if (patch.toOffset !== undefined) arrow.to.offset = normalizeOffset(patch.toOffset);
  if (patch.label != null) arrow.label = patch.label;
  if (patch.style) arrow.style = { ...arrow.style, ...patch.style };
  if (patch.bends) {
    arrow.bends = patch.bends.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }));
  } else if (portsMoved && arrow.routing === 'orthogonal' && arrow.bends.length > 0) {
    // Ports moved, stored bends are now in the wrong place and would draw as whiskers.
    arrow.bends = [];
  }
  if (patch.routing) arrow.routing = patch.routing;
  arrow.updatedAt = Date.now();
  return arrow;
};

export interface RouteApplication {
  bends: Vec2[];
  fromSide: AnchorSide;
  toSide: AnchorSide;
  fromOffset: number;
  toOffset: number;
}

/**
 * Writes an auto-routed polyline. The ports get pinned as well: bends are
 * absolute coordinates, so an endpoint that is still free to move — an `auto`
 * side, or an offset the board redistributes — would silently invalidate the
 * route the next time the arrow is drawn.
 */
export const applyRoute = (state: BoardState, id: string, route: RouteApplication): Arrow => {
  const arrow = findArrow(state, id);
  arrow.bends = route.bends.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }));
  arrow.from.side = route.fromSide;
  arrow.to.side = route.toSide;
  arrow.from.offset = normalizeOffset(route.fromOffset);
  arrow.to.offset = normalizeOffset(route.toOffset);
  arrow.routing = 'orthogonal';
  arrow.updatedAt = Date.now();
  return arrow;
};

export const addBend = (state: BoardState, id: string, point: Vec2, index?: number): Arrow => {
  const arrow = findArrow(state, id);
  const at = index == null ? arrow.bends.length : Math.max(0, Math.min(index, arrow.bends.length));
  arrow.bends.splice(at, 0, { x: Math.round(point.x), y: Math.round(point.y) });
  arrow.updatedAt = Date.now();
  return arrow;
};

export const moveBend = (state: BoardState, id: string, index: number, point: Vec2): Arrow => {
  const arrow = findArrow(state, id);
  if (index < 0 || index >= arrow.bends.length) {
    throw badRequest(`Bend index ${index} out of range (0..${arrow.bends.length - 1})`);
  }
  arrow.bends[index] = { x: Math.round(point.x), y: Math.round(point.y) };
  arrow.updatedAt = Date.now();
  return arrow;
};

export const removeBend = (state: BoardState, id: string, index: number): Arrow => {
  const arrow = findArrow(state, id);
  if (index < 0 || index >= arrow.bends.length) {
    throw badRequest(`Bend index ${index} out of range`);
  }
  arrow.bends.splice(index, 1);
  arrow.updatedAt = Date.now();
  return arrow;
};

export const deleteArrow = (state: BoardState, id: string): void => {
  const index = state.arrows.findIndex((a) => a.id === id);
  if (index < 0) throw notFound(`Arrow ${id}`);
  state.arrows.splice(index, 1);
};

export interface RegionQuery extends Rect {}

export interface RegionResult {
  region: Rect;
  artifacts: Artifact[];
  arrows: Arrow[];
  totalArtifacts: number;
}

/** Artifacts overlapping the region plus every arrow touching one of them. */
export const queryRegion = (state: BoardState, region: RegionQuery): RegionResult => {
  const artifacts = state.artifacts
    .filter((a) => rectsIntersect(a, region))
    .sort((a, b) => a.z - b.z);
  const ids = new Set(artifacts.map((a) => a.id));
  const arrows = state.arrows.filter(
    (arrow) => ids.has(arrow.from.artifactId) || ids.has(arrow.to.artifactId),
  );
  return { region, artifacts, arrows, totalArtifacts: state.artifacts.length };
};
