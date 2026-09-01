import type { AnchorSide, Artifact, Board, Rect, Vec2 } from '@teca/shared';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { artifactDefinition } from '../../artifacts';
import { registerCapture } from '../../state/capture';
import { useStore } from '../../state/store';
import { ArrowLayer } from './ArrowLayer';

interface Props {
  board: Board;
  active: boolean;
}

interface DragState {
  artifactId: string;
  mode: 'move' | 'resize';
  origin: Vec2;
  start: Rect;
}

interface Connecting {
  fromId: string;
  fromSide: Exclude<AnchorSide, 'auto'>;
  point: Vec2;
}

const SIDES: Exclude<AnchorSide, 'auto'>[] = ['top', 'right', 'bottom', 'left'];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

const sideOffset = (side: Exclude<AnchorSide, 'auto'>, artifact: Artifact): Vec2 => {
  switch (side) {
    case 'top':
      return { x: artifact.width / 2, y: 0 };
    case 'bottom':
      return { x: artifact.width / 2, y: artifact.height };
    case 'left':
      return { x: 0, y: artifact.height / 2 };
    default:
      return { x: artifact.width, y: artifact.height / 2 };
  }
};

export const BoardCanvas = ({ board, active }: Props) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<Rect>>>({});
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [bendDraft, setBendDraft] = useState<{ arrowId: string; index: number; point: Vec2 } | null>(null);

  const selection = useStore((s) => s.selection[board.id]);
  const select = useStore((s) => s.select);
  const setViewport = useStore((s) => s.setViewport);
  const applyArtifact = useStore((s) => s.applyArtifact);
  const removeArtifactLocal = useStore((s) => s.removeArtifactLocal);
  const applyArrow = useStore((s) => s.applyArrow);
  const removeArrowLocal = useStore((s) => s.removeArrowLocal);

  const { x: vx, y: vy, zoom } = board.viewport;

  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Vec2 => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (event.clientX - rect.left - vx) / zoom,
        y: (event.clientY - rect.top - vy) / zoom,
      };
    },
    [vx, vy, zoom],
  );

  const artifacts = useMemo(
    () =>
      board.state.artifacts
        .map((artifact) => ({ ...artifact, ...(draft[artifact.id] ?? {}) }))
        .sort((a, b) => a.z - b.z),
    [board.state.artifacts, draft],
  );

  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);

  const arrows = useMemo(() => {
    if (!bendDraft) return board.state.arrows;
    return board.state.arrows.map((arrow) => {
      if (arrow.id !== bendDraft.arrowId) return arrow;
      const bends = arrow.bends.slice();
      bends[bendDraft.index] = bendDraft.point;
      return { ...arrow, bends };
    });
  }, [board.state.arrows, bendDraft]);

  // Panning and zooming.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-event.deltaY / 400)));
        const ratio = next / zoom;
        setViewport(board.id, {
          x: px - (px - vx) * ratio,
          y: py - (py - vy) * ratio,
          zoom: next,
        });
      } else {
        setViewport(board.id, { x: vx - event.deltaX, y: vy - event.deltaY, zoom });
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [board.id, setViewport, vx, vy, zoom]);

  // Rasterizes a world region for the agent's screenshot tool.
  useEffect(() => {
    return registerCapture(board.id, async (region: Rect) => {
      const node = layerRef.current;
      if (!node) return null;
      const scale = Math.min(2, Math.max(0.3, 1200 / Math.max(region.width, region.height, 1)));
      return toPng(node, {
        width: Math.round(region.width * scale),
        height: Math.round(region.height * scale),
        backgroundColor: '#0e1014',
        pixelRatio: 1,
        style: {
          transform: `scale(${scale}) translate(${-region.x}px, ${-region.y}px)`,
          transformOrigin: 'top left',
        },
      });
    });
  }, [board.id]);

  const commitArtifact = async (artifact: Artifact, patch: Partial<Rect>) => {
    setDraft((current) => {
      const { [artifact.id]: _dropped, ...rest } = current;
      return rest;
    });
    const updated = await api.patchArtifact(board.id, artifact.id, patch);
    applyArtifact(board.id, updated);
  };

  const onArtifactPointerDown = (event: React.PointerEvent, artifact: Artifact, mode: 'move' | 'resize') => {
    event.stopPropagation();
    select(board.id, { artifactId: artifact.id });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({
      artifactId: artifact.id,
      mode,
      origin: toWorld(event),
      start: { x: artifact.x, y: artifact.y, width: artifact.width, height: artifact.height },
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (connecting) {
      setConnecting({ ...connecting, point: toWorld(event) });
      return;
    }
    if (!drag) return;
    const world = toWorld(event);
    const dx = world.x - drag.origin.x;
    const dy = world.y - drag.origin.y;
    setDraft((current) => ({
      ...current,
      [drag.artifactId]:
        drag.mode === 'move'
          ? { x: Math.round(drag.start.x + dx), y: Math.round(drag.start.y + dy) }
          : {
              width: Math.max(40, Math.round(drag.start.width + dx)),
              height: Math.max(40, Math.round(drag.start.height + dy)),
            },
    }));
  };

  const onPointerUp = async (event: React.PointerEvent) => {
    if (connecting) {
      const world = toWorld(event);
      const target = board.state.artifacts.find(
        (a) =>
          a.id !== connecting.fromId &&
          world.x >= a.x &&
          world.x <= a.x + a.width &&
          world.y >= a.y &&
          world.y <= a.y + a.height,
      );
      setConnecting(null);
      if (target) {
        const arrow = await api.createArrow(board.id, {
          fromId: connecting.fromId,
          toId: target.id,
          fromSide: connecting.fromSide,
          toSide: 'auto',
        });
        applyArrow(board.id, arrow);
      }
      return;
    }
    if (!drag) return;
    const patch = draft[drag.artifactId];
    const artifact = board.state.artifacts.find((a) => a.id === drag.artifactId);
    setDrag(null);
    if (artifact && patch) await commitArtifact(artifact, patch);
  };

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    select(board.id, {});
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = vx;
    const originY = vy;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      setViewport(board.id, {
        x: originX + (ev.clientX - startX),
        y: originY + (ev.clientY - startY),
        zoom,
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = async (event: KeyboardEvent) => {
      const editingField = (event.target as HTMLElement)?.closest('input, textarea');
      if (editingField) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const current = useStore.getState().selection[board.id];
      if (current?.artifactId) {
        await api.deleteArtifact(board.id, current.artifactId);
        removeArtifactLocal(board.id, current.artifactId);
        select(board.id, {});
      } else if (current?.arrowId) {
        await api.deleteArrow(board.id, current.arrowId);
        removeArrowLocal(board.id, current.arrowId);
        select(board.id, {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, board.id, removeArtifactLocal, removeArrowLocal, select]);

  return (
    <div
      className="board-canvas"
      ref={viewportRef}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${vx}px ${vy}px`,
      }}
    >
      <div
        className="board-layer"
        ref={layerRef}
        style={{ transform: `translate(${vx}px, ${vy}px) scale(${zoom})`, transformOrigin: 'top left' }}
      >
        <ArrowLayer
          arrows={arrows}
          artifacts={artifactMap}
          zoom={zoom}
          selectedId={selection?.arrowId}
          toWorld={toWorld}
          onSelect={(arrowId) => select(board.id, { arrowId })}
          onAddBend={async (arrowId, index, point) => {
            const arrow = await api.addBend(board.id, arrowId, { ...point, index });
            applyArrow(board.id, arrow);
          }}
          onDragBend={async (arrowId, index, point, commit) => {
            if (!commit) {
              setBendDraft({ arrowId, index, point });
              return;
            }
            setBendDraft(null);
            const arrow = await api.moveBend(board.id, arrowId, index, point);
            applyArrow(board.id, arrow);
          }}
          onRemoveBend={async (arrowId, index) => {
            const arrow = await api.removeBend(board.id, arrowId, index);
            applyArrow(board.id, arrow);
          }}
        />

        {connecting && (
          <svg className="connect-preview" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' }}>
            {(() => {
              const from = artifactMap.get(connecting.fromId);
              if (!from) return null;
              const offset = sideOffset(connecting.fromSide, from);
              return (
                <line
                  x1={from.x + offset.x}
                  y1={from.y + offset.y}
                  x2={connecting.point.x}
                  y2={connecting.point.y}
                  stroke="#7aa2ff"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                />
              );
            })()}
          </svg>
        )}

        {artifacts.map((artifact) => {
          const definition = artifactDefinition(artifact.type);
          const isSelected = selection?.artifactId === artifact.id;
          return (
            <div
              key={artifact.id}
              className={`artifact ${isSelected ? 'selected' : ''}`}
              data-type={artifact.type}
              style={{
                left: artifact.x,
                top: artifact.y,
                width: artifact.width,
                height: artifact.height,
                zIndex: artifact.z,
                transform: artifact.rotation ? `rotate(${artifact.rotation}deg)` : undefined,
              }}
              onPointerDown={(e) => onArtifactPointerDown(e, artifact, 'move')}
            >
              <div className="artifact-body">
                {definition.render({
                  artifact,
                  selected: isSelected,
                  onPatch: async (props) => {
                    const updated = await api.patchArtifact(board.id, artifact.id, { props });
                    applyArtifact(board.id, updated);
                  },
                })}
              </div>

              {isSelected && (
                <>
                  <div
                    className="resize-handle"
                    onPointerDown={(e) => onArtifactPointerDown(e, artifact, 'resize')}
                  />
                  {SIDES.map((side) => {
                    const offset = sideOffset(side, artifact);
                    return (
                      <div
                        key={side}
                        className={`anchor anchor-${side}`}
                        style={{ left: offset.x, top: offset.y }}
                        title={`Соединить (${side})`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget.parentElement?.parentElement as HTMLElement | null)?.blur();
                          setConnecting({ fromId: artifact.id, fromSide: side, point: toWorld(e) });
                        }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
