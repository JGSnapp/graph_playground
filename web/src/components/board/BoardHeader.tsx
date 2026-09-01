import type { ArtifactType, Board } from '@teca/shared';
import { boardQuality, boundsOf } from '@teca/shared';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { ARTIFACT_DEFINITIONS } from '../../artifacts';
import { useStore } from '../../state/store';

interface Props {
  board: Board;
  active: boolean;
}

export const BoardHeader = ({ board, active }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const models = useStore((s) => s.models);
  const history = useStore((s) => s.history[board.id]);
  const running = useStore((s) => Boolean(s.runs[board.id]));
  const { undo, redo, renameBoard, setBoardModel, removeBoard, applyArtifact, setViewport } = useStore();

  const quality = useMemo(
    () =>
      board.state.arrows.length > 0 || board.state.artifacts.length > 1
        ? boardQuality(board.state.artifacts, board.state.arrows)
        : null,
    [board.state],
  );

  const addArtifact = async (type: ArtifactType) => {
    setMenuOpen(false);
    const existing = board.state.artifacts;
    const bounds = existing.length ? boundsOf(existing) : { x: 0, y: 0, width: 0, height: 0 };
    const artifact = await api.createArtifact(board.id, {
      type,
      x: existing.length ? bounds.x : 40,
      y: existing.length ? bounds.y + bounds.height + 40 : 40,
    });
    applyArtifact(board.id, artifact);
  };

  const fitToContent = () => {
    const artifacts = board.state.artifacts;
    if (artifacts.length === 0) {
      setViewport(board.id, { x: 0, y: 0, zoom: 1 });
      return;
    }
    const bounds = boundsOf(artifacts);
    const pad = 60;
    const width = bounds.width + pad * 2;
    const height = bounds.height + pad * 2;
    // Board cards are roughly 640x520 CSS pixels; close enough for a fit action.
    const zoom = Math.min(1.5, Math.max(0.15, Math.min(640 / width, 520 / height)));
    setViewport(board.id, {
      x: -(bounds.x - pad) * zoom,
      y: -(bounds.y - pad) * zoom,
      zoom,
    });
  };

  return (
    <header className="board-header">
      <div className="board-title-row">
        {editingTitle ? (
          <input
            className="board-title-input"
            autoFocus
            defaultValue={board.title}
            onBlur={(e) => {
              setEditingTitle(false);
              if (e.target.value.trim() && e.target.value !== board.title) {
                void renameBoard(board.id, e.target.value.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
          />
        ) : (
          <button className="board-title" onDoubleClick={() => setEditingTitle(true)} type="button">
            {board.title}
          </button>
        )}
        {running && <span className="badge running">агент работает</span>}
        {active && <span className="badge">активна</span>}
        <span className="board-meta">
          {board.state.artifacts.length} арт · {board.state.arrows.length} связей
        </span>
        {quality && (
          <span
            className={`badge quality q-${quality.grade === 'отлично' ? 'great' : quality.grade === 'хорошо' ? 'good' : quality.grade === 'терпимо' ? 'meh' : 'bad'}`}
            title={[
              `Качество раскладки: ${quality.score}/100 (${quality.grade}), штраф ${quality.cost}`,
              ...quality.breakdown.map((item) => `${item.reason}: ${item.count} → ${Math.round(item.cost * 10) / 10}`),
              ...quality.hints,
            ].join('\n')}
          >
            {quality.score}/100
          </span>
        )}
      </div>

      <div className="board-actions">
        <button
          type="button"
          title="Отменить"
          disabled={!history?.canUndo}
          onClick={() => void undo(board.id)}
        >
          ↶
        </button>
        <button
          type="button"
          title="Вернуть"
          disabled={!history?.canRedo}
          onClick={() => void redo(board.id)}
        >
          ↷
        </button>

        <div className="menu-wrap">
          <button type="button" title="Добавить артефакт" onClick={() => setMenuOpen((v) => !v)}>
            +
          </button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              {ARTIFACT_DEFINITIONS.map((definition) => (
                <button key={definition.type} type="button" onClick={() => void addArtifact(definition.type)}>
                  <span className="glyph">{definition.glyph}</span>
                  {definition.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" title="Вписать содержимое" onClick={fitToContent}>
          ⤢
        </button>

        <select
          className="model-select"
          value={board.model}
          title="Модель агента для этой доски"
          onChange={(e) => void setBoardModel(board.id, e.target.value)}
        >
          {!models.some((m) => m.id === board.model) && <option value={board.model}>{board.model}</option>}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          title="Удалить доску"
          className="danger"
          onClick={() => {
            if (confirm(`Удалить доску «${board.title}»?`)) void removeBoard(board.id);
          }}
        >
          ×
        </button>
      </div>
    </header>
  );
};
