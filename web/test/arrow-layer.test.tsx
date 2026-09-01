import type { Arrow, Artifact } from '@teca/shared';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArrowLayer } from '../src/components/board/ArrowLayer';

const artifact = (id: string, x: number): Artifact => ({
  id,
  type: 'note',
  x,
  y: 0,
  width: 200,
  height: 100,
  z: 1,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

const arrow: Arrow = {
  id: 'arrow-1',
  from: { artifactId: 'from', side: 'right' },
  to: { artifactId: 'to', side: 'left' },
  bends: [],
  label: 'depends on',
  style: {},
  createdAt: 0,
  updatedAt: 0,
};

describe('ArrowLayer', () => {
  it('keeps label size in board units instead of compensating for zoom', () => {
    const artifacts = new Map([
      ['from', artifact('from', 0)],
      ['to', artifact('to', 400)],
    ]);
    const props = {
      arrows: [arrow],
      artifacts,
      selectedId: undefined,
      onSelect: vi.fn(),
      onAddBend: vi.fn(),
      onDragBend: vi.fn(),
      onRemoveBend: vi.fn(),
      toWorld: vi.fn(),
    };

    const { container, rerender } = render(<ArrowLayer {...props} zoom={1} />);
    const labelAtOne = container.querySelector('.arrow-label');
    expect(labelAtOne?.getAttribute('font-size')).toBe('12');
    expect(labelAtOne?.getAttribute('style')).not.toContain('font-size');

    rerender(<ArrowLayer {...props} zoom={0.25} />);
    const labelZoomedOut = container.querySelector('.arrow-label');
    expect(labelZoomedOut?.getAttribute('font-size')).toBe('12');
    expect(labelZoomedOut?.getAttribute('style')).not.toContain('font-size');
  });
});
