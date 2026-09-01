/**
 * Observational metrics for the bench report.
 *
 * These are deliberately NOT part of `shared/quality.ts`: they describe things
 * the current engine does not score (semantic grouping, grid discipline,
 * compactness, completeness). A metric only moves into the engine once an
 * experiment shows the agent actually needs it.
 */
import { boundsOf, computeArrowGeometries, type BoardState } from '@teca/shared';

export interface LayoutObservations {
  artifacts: number;
  arrows: number;
  /** Bounding box of the composition. */
  width: number;
  height: number;
  /** width/height; far from 1 means a stretched, hard to read composition. */
  aspect: number;
  /** Share of the bounding box actually covered by artifacts, 0..1. */
  density: number;
  /** Centre-to-centre distance between connected nodes. */
  edgeLengthMedian: number;
  edgeLengthMax: number;
  /** max/median: a long tail means one connection is dragged across the board. */
  edgeLengthSpread: number;
  /**
   * Mean distance to unconnected nodes divided by mean distance to connected
   * ones. Above 1 means "what is linked sits closer than what is not", which is
   * the readable-distance rule. The earlier "is the nearest neighbour a
   * connected node" version punished layered layouts, where a node's closest
   * neighbour is legitimately its unconnected layer-mate.
   */
  separation: number;
  /** Nodes whose text does not fit the box at the size the board renders it. */
  textOverflow: number;
  /** Share of nodes sharing an x (or y) coordinate with another node. */
  alignedShare: number;
  /** Distinct x/y coordinate lanes; fewer lanes read as a cleaner grid. */
  columnLanes: number;
  rowLanes: number;
  /** Nodes with no arrows attached. */
  isolatedNodes: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const LANE_TOL = 24;

/**
 * Does the artifact's text fit its box? Approximate on purpose — real metrics
 * live in the browser — but good enough to catch a 40-line note in a 240x180
 * card, which every real board had and no engine metric noticed.
 */
const overflowsBox = (artifact: { width: number; height: number; type: string; props: unknown }): boolean => {
  const props = (artifact.props ?? {}) as Record<string, unknown>;
  const raw = ['text', 'label', 'code'].map((key) => props[key]).find((v) => typeof v === 'string') as
    | string
    | undefined;
  if (!raw || !raw.trim()) return false;
  const fontSize = typeof props.fontSize === 'number' ? props.fontSize : artifact.type === 'code' ? 12 : 13;
  const padding = artifact.type === 'text' ? 0 : 24;
  const usable = Math.max(20, artifact.width - padding);
  const perLine = Math.max(4, Math.floor(usable / (fontSize * 0.53)));
  const lines = raw
    .split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.replace(/[#*`_]/g, '').length / perLine)), 0);
  const lineHeight = fontSize * 1.38;
  const available = Math.max(0, artifact.height - padding);
  return lines * lineHeight > available;
};

const laneCount = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  let lanes = 0;
  let last = -Infinity;
  for (const value of sorted) {
    if (value - last > LANE_TOL) {
      lanes += 1;
      last = value;
    }
  }
  return lanes;
};

export const observe = (state: BoardState): LayoutObservations => {
  const { artifacts, arrows } = state;
  const centres = new Map(
    artifacts.map((a) => [a.id, { x: a.x + a.width / 2, y: a.y + a.height / 2 }]),
  );

  const bounds = artifacts.length ? boundsOf(artifacts) : { x: 0, y: 0, width: 0, height: 0 };
  const area = Math.max(1, bounds.width * bounds.height);
  const covered = artifacts.reduce((sum, a) => sum + a.width * a.height, 0);

  const lengths: number[] = [];
  const connected = new Map<string, Set<string>>();
  for (const arrow of arrows) {
    const a = centres.get(arrow.from.artifactId);
    const b = centres.get(arrow.to.artifactId);
    if (!a || !b) continue;
    lengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    if (!connected.has(arrow.from.artifactId)) connected.set(arrow.from.artifactId, new Set());
    if (!connected.has(arrow.to.artifactId)) connected.set(arrow.to.artifactId, new Set());
    connected.get(arrow.from.artifactId)!.add(arrow.to.artifactId);
    connected.get(arrow.to.artifactId)!.add(arrow.from.artifactId);
  }

  let linkedSum = 0;
  let linkedCount = 0;
  let strangerSum = 0;
  let strangerCount = 0;
  for (const artifact of artifacts) {
    const peers = connected.get(artifact.id);
    if (!peers || peers.size === 0) continue;
    const self = centres.get(artifact.id)!;
    for (const other of artifacts) {
      if (other.id === artifact.id) continue;
      const o = centres.get(other.id)!;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (peers.has(other.id)) {
        linkedSum += d;
        linkedCount += 1;
      } else {
        strangerSum += d;
        strangerCount += 1;
      }
    }
  }
  const meanLinked = linkedCount ? linkedSum / linkedCount : 0;
  const meanStranger = strangerCount ? strangerSum / strangerCount : 0;
  const separation = meanLinked > 0 ? meanStranger / meanLinked : 0;

  const xs = artifacts.map((a) => a.x);
  const ys = artifacts.map((a) => a.y);
  const shares = (values: number[]): number => {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.values()].filter((count) => count > 1).reduce((sum, c) => sum + c, 0);
  };
  const aligned = artifacts.length
    ? Math.min(1, (shares(xs) + shares(ys)) / (artifacts.length * 2))
    : 0;

  const medianLength = median(lengths);
  const maxLength = lengths.length ? Math.max(...lengths) : 0;

  return {
    artifacts: artifacts.length,
    arrows: arrows.length,
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    aspect: bounds.height ? Math.round((bounds.width / bounds.height) * 100) / 100 : 0,
    density: Math.round((covered / area) * 100) / 100,
    edgeLengthMedian: Math.round(medianLength),
    edgeLengthMax: Math.round(maxLength),
    edgeLengthSpread: medianLength ? Math.round((maxLength / medianLength) * 100) / 100 : 0,
    separation: Math.round(separation * 100) / 100,
    textOverflow: artifacts.filter(overflowsBox).length,
    alignedShare: Math.round(aligned * 100) / 100,
    columnLanes: laneCount(xs),
    rowLanes: laneCount(ys),
    isolatedNodes: artifacts.filter((a) => !connected.has(a.id)).length,
  };
};

/** Total drawn polyline length; used to see whether routing got shorter. */
export const drawnLength = (state: BoardState): number => {
  const geometries = computeArrowGeometries(state.artifacts, state.arrows);
  let total = 0;
  for (const geometry of geometries.values()) {
    for (let i = 0; i < geometry.points.length - 1; i++) {
      const a = geometry.points[i];
      const b = geometry.points[i + 1];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return Math.round(total);
};
