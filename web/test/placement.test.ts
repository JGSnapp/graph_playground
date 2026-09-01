import type { Arrow, Artifact } from '@teca/shared';
import { overlappingNeighbors, rankArtifactPlacements } from '@teca/shared';
import { describe, expect, it } from 'vitest';

const box = (id: string, x: number, y: number, width = 200, height = 100): Artifact => ({
  id,
  type: 'note',
  x,
  y,
  width,
  height,
  z: 1,
  props: { text: id },
  createdAt: 0,
  updatedAt: 0,
});

const arrow = (id: string, from: string, to: string): Arrow => ({
  id,
  from: { artifactId: from, side: 'right' },
  to: { artifactId: to, side: 'left' },
  bends: [],
  style: {},
  createdAt: 0,
  updatedAt: 0,
});

describe('overlappingNeighbors', () => {
  it('finds a box that covers the candidate and ignores self', () => {
    const artifacts = [box('a', 0, 0), box('b', 400, 0)];
    expect(overlappingNeighbors({ x: 50, y: 0, width: 200, height: 100 }, artifacts).map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(overlappingNeighbors(artifacts[0], artifacts, 'a')).toHaveLength(0);
  });
});

describe('rankArtifactPlacements', () => {
  it('prefers a free facing seat over sitting on the neighbour', () => {
    const artifacts = [box('a', 0, 0), box('b', 400, 0)];
    const arrows = [arrow('r', 'a', 'b')];
    const result = rankArtifactPlacements(artifacts, arrows, 'b', [
      { x: 40, y: 0, label: 'на A' },
      { x: 480, y: 0, label: 'справа' },
    ]);
    expect(result.bestIndex).toBe(1);
    expect(result.ranked[0].label).toBe('справа');
    expect(result.ranked[0].overlaps).toHaveLength(0);
    expect(result.ranked.find((row) => row.label === 'на A')?.overlaps.length).toBeGreaterThan(0);
  });
});
