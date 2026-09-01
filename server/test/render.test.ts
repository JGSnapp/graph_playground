import type { Artifact, BoardState } from '@teca/shared';
import { describe, expect, it } from 'vitest';
import { renderAsciiSchema, renderSvgSchema } from '../src/modules/agent/render.js';

const artifact = (id: string, x: number, y: number, text: string): Artifact => ({
  id,
  type: 'note',
  x,
  y,
  width: 200,
  height: 120,
  z: 1,
  props: { text },
  createdAt: 0,
  updatedAt: 0,
});

const state: BoardState = {
  artifacts: [artifact('art_aaaa', 0, 0, 'слева'), artifact('art_bbbb', 400, 0, 'справа')],
  arrows: [
    {
      id: 'arr_1',
      from: { artifactId: 'art_aaaa', side: 'right' },
      to: { artifactId: 'art_bbbb', side: 'left' },
      bends: [{ x: 320, y: 40 }],
      label: 'связь',
      style: {},
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

describe('board rendering for the agent', () => {
  const region = { x: -50, y: -50, width: 700, height: 300 };

  it('draws boxes and lists artifacts with their coordinates', () => {
    const schema = renderAsciiSchema(state, region);
    expect(schema).toContain('art_aaaa');
    expect(schema).toContain('@(400,0)');
    expect(schema).toContain('+--');
    expect(schema).toMatch(/arr_1: art_aaaa\(right\) -> art_bbbb\(left\)/);
    expect(schema).toContain('bends=(320,40)');
  });

  it('says the region is empty when nothing intersects it', () => {
    const schema = renderAsciiSchema(state, { x: 9000, y: 9000, width: 400, height: 400 });
    expect(schema).toContain('нет в этой области');
  });

  it('produces svg with one shape per artifact and a polyline per arrow', () => {
    const svg = renderSvgSchema(state, region);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<rect /g)?.length).toBe(3); // background + two artifacts
    expect(svg).toContain('<polyline');
    expect(svg).toContain('viewBox="-50 -50 700 300"');
  });

  it('escapes text so artifact content cannot break the svg', () => {
    const risky: BoardState = {
      artifacts: [artifact('art_x', 0, 0, '<script>alert("x")</script>')],
      arrows: [],
    };
    const svg = renderSvgSchema(risky, region);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
