/**
 * Port assignment search.
 *
 * The router lays each arrow on its own, so which side and which point of a
 * node an arrow attaches to is decided once and never revisited. On the bench
 * boards two thirds of the remaining crossings were between arrows meeting at
 * the same node — the shape you get when three lines arrive in the order
 * 1-2-3 where 2-1-3 would not cross.
 *
 * Pricing does not fix that: raising the cost of a crossing twenty-five-fold
 * left the count unchanged, because the router has no way to *express* a
 * different attachment. This searches over the attachments themselves: swap the
 * ports of two arrows meeting at one node, re-lay them, keep the swap when the
 * board scores better. Repeat until nothing improves.
 */
import type { Arrow, Artifact } from './artifacts.js';
import { FIXED_SIDES, type FixedSide } from './geometry.js';
import { boardQuality } from './quality.js';
import { routeArrows, tooTightToRoute } from './routing.js';

interface End {
  arrowId: string;
  end: 'from' | 'to';
  side: FixedSide;
  offset: number;
}

export interface PortSearchOptions {
  /** Give up after this many accepted moves of any kind. */
  maxSwaps?: number;
  /**
   * Work budget: candidates evaluated before the search stops, accepted or
   * not. Each candidate costs one short routing call, so without this a dense
   * board with three move types per end takes minutes.
   */
  maxTried?: number;
  /** Sweeps over every node before stopping. */
  passes?: number;
  /** Arrows whose ports the caller pinned deliberately; never touched. */
  lockedArrowIds?: string[];
}

export interface PortSearchResult {
  arrows: Arrow[];
  /** Accepted swaps between two arrows meeting at one node. */
  swaps: number;
  /** Accepted moves of one end to another side of its node. */
  moves: number;
  /** Accepted nudges of one end along the side it already sits on. */
  nudges: number;
  costBefore: number;
  costAfter: number;
  /** Swaps that were tried and rejected, for the report. */
  tried: number;
}

const endsAt = (arrows: Arrow[], artifactId: string, locked: Set<string>): End[] => {
  const out: End[] = [];
  for (const arrow of arrows) {
    if (locked.has(arrow.id)) continue;
    if (arrow.from.artifactId === artifactId && arrow.from.side !== 'auto') {
      out.push({
        arrowId: arrow.id,
        end: 'from',
        side: arrow.from.side,
        offset: arrow.from.offset ?? 0.5,
      });
    }
    if (arrow.to.artifactId === artifactId && arrow.to.side !== 'auto') {
      out.push({
        arrowId: arrow.id,
        end: 'to',
        side: arrow.to.side,
        offset: arrow.to.offset ?? 0.5,
      });
    }
  }
  return out;
};

/** Candidate points along a side, from the middle outwards. */
const OFFSETS = [0.5, 0.28, 0.72, 0.14, 0.86];

/** Slides one end along the side it already sits on. */
const withNudgedOffset = (arrows: Arrow[], end: End, offset: number): Arrow[] =>
  arrows.map((arrow) => {
    if (arrow.id !== end.arrowId) return arrow;
    const patched = { ...arrow, bends: [] };
    const endpoint = end.end === 'from' ? { ...patched.from } : { ...patched.to };
    endpoint.offset = offset;
    if (end.end === 'from') patched.from = endpoint;
    else patched.to = endpoint;
    return patched;
  });

/** Moves one end to another side, letting the distribution pick the point. */
const withMovedSide = (arrows: Arrow[], end: End, side: FixedSide): Arrow[] =>
  arrows.map((arrow) => {
    if (arrow.id !== end.arrowId) return arrow;
    const patched = { ...arrow, bends: [] };
    const endpoint = end.end === 'from' ? { ...patched.from } : { ...patched.to };
    endpoint.side = side;
    // Released, so the port lands where the spread puts it on the new side.
    endpoint.offset = undefined;
    if (end.end === 'from') patched.from = endpoint;
    else patched.to = endpoint;
    return patched;
  });

const withSwappedPorts = (arrows: Arrow[], a: End, b: End): Arrow[] =>
  arrows.map((arrow) => {
    if (arrow.id === a.arrowId) {
      const patched = { ...arrow };
      const endpoint = a.end === 'from' ? { ...patched.from } : { ...patched.to };
      endpoint.side = b.side;
      endpoint.offset = b.offset;
      if (a.end === 'from') patched.from = endpoint;
      else patched.to = endpoint;
      // The stored polyline was built for the old attachment.
      patched.bends = [];
      return patched;
    }
    if (arrow.id === b.arrowId) {
      const patched = { ...arrow };
      const endpoint = b.end === 'from' ? { ...patched.from } : { ...patched.to };
      endpoint.side = a.side;
      endpoint.offset = a.offset;
      if (b.end === 'from') patched.from = endpoint;
      else patched.to = endpoint;
      patched.bends = [];
      return patched;
    }
    return arrow;
  });

const relay = (artifacts: Artifact[], arrows: Arrow[], arrowIds: string[]): Arrow[] | null => {
  if (!tooTightToRoute(artifacts, arrows, arrowIds).ready) return null;
  const outcome = routeArrows(artifacts, arrows, { arrowIds });
  if (outcome.refused) return null;
  return arrows.map((arrow) => {
    const routed = outcome.routed.find((item) => item.arrowId === arrow.id);
    if (!routed) return arrow;
    return {
      ...arrow,
      bends: routed.bends,
      routing: 'orthogonal' as const,
      from: { ...arrow.from, side: routed.fromSide, offset: routed.fromOffset },
      to: { ...arrow.to, side: routed.toSide, offset: routed.toOffset },
    };
  });
};

/**
 * Hill climbing over port swaps. Only two arrows are re-laid per candidate, so
 * a rejected swap costs one short routing call rather than a full re-route.
 */
export const searchPorts = (
  artifacts: Artifact[],
  arrows: Arrow[],
  options: PortSearchOptions = {},
): PortSearchResult => {
  const maxSwaps = options.maxSwaps ?? 24;
  const maxTried = options.maxTried ?? 400;
  const passes = options.passes ?? 2;
  const locked = new Set(options.lockedArrowIds ?? []);

  const costBefore = boardQuality(artifacts, arrows).cost;
  let current = arrows;
  let currentCost = costBefore;
  let swaps = 0;
  let moves = 0;
  let nudges = 0;
  let tried = 0;

  for (let pass = 0; pass < passes && swaps + moves + nudges < maxSwaps && tried < maxTried; pass++) {
    let improvedThisPass = false;

    for (const artifact of artifacts) {
      if (swaps + moves + nudges >= maxSwaps || tried >= maxTried) break;
      const ends = endsAt(current, artifact.id, locked);
      if (ends.length === 0) continue;

      // Third move type: slide one end along the side it is already on. A swap
      // needs a partner and a side move changes the direction the line leaves
      // in; sliding is the smallest correction there is, and it is the one that
      // straightens a line that had to bend around its own neighbour.
      for (const end of ends) {
        if (swaps + moves + nudges >= maxSwaps || tried >= maxTried) break;
        for (const offset of OFFSETS) {
          if (Math.abs(offset - end.offset) < 0.02) continue;
          tried += 1;
          const nudged = withNudgedOffset(current, end, offset);
          const relaid = relay(artifacts, nudged, [end.arrowId]);
          if (!relaid) continue;
          const cost = boardQuality(artifacts, relaid).cost;
          if (cost < currentCost - 1e-6) {
            current = relaid;
            currentCost = cost;
            nudges += 1;
            improvedThisPass = true;
            break;
          }
        }
      }

      // Second move type: send one end to another side of the same node. A
      // swap can only reshuffle the sides already in use, so a node whose
      // arrows all arrive on one side has nothing to trade.
      for (const end of ends) {
        if (swaps + moves + nudges >= maxSwaps || tried >= maxTried) break;
        for (const side of FIXED_SIDES) {
          if (side === end.side) continue;
          tried += 1;
          const movedArrows = withMovedSide(current, end, side);
          const relaid = relay(artifacts, movedArrows, [end.arrowId]);
          if (!relaid) continue;
          const cost = boardQuality(artifacts, relaid).cost;
          if (cost < currentCost - 1e-6) {
            current = relaid;
            currentCost = cost;
            moves += 1;
            improvedThisPass = true;
            break;
          }
        }
      }

      for (let i = 0; i < ends.length && swaps + moves + nudges < maxSwaps && tried < maxTried; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const a = ends[i];
          const b = ends[j];
          if (a.arrowId === b.arrowId) continue;
          if (a.side === b.side && Math.abs(a.offset - b.offset) < 1e-6) continue;

          tried += 1;
          const swapped = withSwappedPorts(current, a, b);
          const relaid = relay(artifacts, swapped, [a.arrowId, b.arrowId]);
          if (!relaid) continue;

          const cost = boardQuality(artifacts, relaid).cost;
          // A swap has to pay for itself: equal cost keeps the original, so the
          // search cannot wander sideways forever.
          if (cost < currentCost - 1e-6) {
            current = relaid;
            currentCost = cost;
            swaps += 1;
            improvedThisPass = true;
            break;
          }
        }
      }
    }

    if (!improvedThisPass) break;
  }

  return { arrows: current, swaps, moves, nudges, tried, costBefore, costAfter: currentCost };
};
