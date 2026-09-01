import type { Arrow, ArrowGeometry, Artifact, Vec2 } from '@teca/shared';
import { LABEL_GAP, arrowHeadVertices, computeArrowGeometries, labelAnchor } from '@teca/shared';
import { useMemo } from 'react';

interface Props {
  arrows: Arrow[];
  artifacts: Map<string, Artifact>;
  zoom: number;
  selectedId?: string;
  onSelect: (arrowId: string) => void;
  onAddBend: (arrowId: string, index: number, point: Vec2) => void;
  onDragBend: (arrowId: string, index: number, point: Vec2, commit: boolean) => void;
  onRemoveBend: (arrowId: string, index: number) => void;
  toWorld: (event: { clientX: number; clientY: number }) => Vec2;
}

/** SVG user units: the board transform scales this together with every artifact. */
const LABEL_FONT = 12;

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const ArrowLayer = ({
  arrows,
  artifacts,
  zoom,
  selectedId,
  onSelect,
  onAddBend,
  onDragBend,
  onRemoveBend,
  toWorld,
}: Props) => {
  // Ports are distributed across every arrow sharing a side, so geometry is
  // computed for the whole board at once rather than per arrow.
  const geometries = useMemo(() => {
    const computed = computeArrowGeometries(artifacts, arrows);
    return arrows
      .map((arrow) => ({ arrow, geometry: computed.get(arrow.id) }))
      .filter((item): item is { arrow: Arrow; geometry: ArrowGeometry } => Boolean(item.geometry));
  }, [arrows, artifacts]);

  const handleSize = 8 / zoom;

  return (
    <svg className="arrow-layer" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' }}>
      {geometries.map(({ arrow, geometry }) => {
        const points = geometry.points;
        const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const selected = arrow.id === selectedId;
        const color = selected ? '#7aa2ff' : (arrow.style.color ?? '#8b93a7');
        const label = arrow.label;
        const anchor = labelAnchor(points);
        const headSize = 10;
        const toHead = arrowHeadVertices(geometry.toPoint, geometry.toSide, headSize);
        const fromHead = arrow.style.bidirectional
          ? arrowHeadVertices(geometry.fromPoint, geometry.fromSide, headSize)
          : null;
        const poly = (verts: [Vec2, Vec2, Vec2]) =>
          `${verts[0].x},${verts[0].y} ${verts[1].x},${verts[1].y} ${verts[2].x},${verts[2].y}`;
        return (
          <g key={arrow.id} className={`arrow ${selected ? 'selected' : ''}`}>
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={14 / zoom}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(arrow.id);
              }}
            />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={arrow.style.width ?? 1.8}
              strokeDasharray={arrow.style.dashed ? `${6 / zoom} ${5 / zoom}` : undefined}
              style={{ pointerEvents: 'none' }}
            />
            <polygon points={poly(toHead)} fill={color} style={{ pointerEvents: 'none' }} />
            {fromHead && <polygon points={poly(fromHead)} fill={color} style={{ pointerEvents: 'none' }} />}
            {label && anchor && (
              <text
                x={anchor.horizontal ? anchor.point.x : anchor.point.x + LABEL_GAP}
                y={anchor.horizontal ? anchor.point.y - LABEL_GAP : anchor.point.y}
                fill="#c7ccd8"
                textAnchor={anchor.horizontal ? 'middle' : 'start'}
                dominantBaseline={anchor.horizontal ? 'auto' : 'middle'}
                stroke="#0e1014"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
                fontSize={LABEL_FONT}
                className="arrow-label"
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            )}
            {selected && (
              <>
                {points.slice(0, -1).map((point, index) => {
                  const mid = midpoint(point, points[index + 1]);
                  const insertAt = geometry.insertAt[index] ?? arrow.bends.length;
                  return (
                    <circle
                      key={`add-${index}`}
                      cx={mid.x}
                      cy={mid.y}
                      r={handleSize / 2}
                      className="bend-add"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onAddBend(arrow.id, insertAt, mid);
                      }}
                    />
                  );
                })}
                {arrow.bends.map((bend, index) => (
                  <rect
                    key={`bend-${index}`}
                    x={bend.x - handleSize / 2}
                    y={bend.y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    className="bend-handle"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onRemoveBend(arrow.id, index);
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const target = e.currentTarget;
                      target.setPointerCapture(e.pointerId);
                      const move = (ev: PointerEvent) => onDragBend(arrow.id, index, toWorld(ev), false);
                      const up = (ev: PointerEvent) => {
                        onDragBend(arrow.id, index, toWorld(ev), true);
                        target.removeEventListener('pointermove', move);
                        target.removeEventListener('pointerup', up);
                      };
                      target.addEventListener('pointermove', move);
                      target.addEventListener('pointerup', up);
                    }}
                  />
                ))}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
};
