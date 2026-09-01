import { useEffect, useRef, useState } from 'react';
import { BoardsStrip } from './components/board/BoardsStrip';
import { ChatPanel } from './components/chat/ChatPanel';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { useStore } from './state/store';

const MIN_CHAT = 320;
const MAX_CHAT = 720;

export const App = () => {
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const init = useStore((s) => s.init);
  const boards = useStore((s) => s.boards);
  const addBoard = useStore((s) => s.addBoard);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(400);
  const dragging = useRef(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const next = window.innerWidth - event.clientX;
      setChatWidth(Math.min(MAX_CHAT, Math.max(MIN_CHAT, next)));
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div className="app" style={{ gridTemplateColumns: `1fr 4px ${chatWidth}px` }}>
      <main className="workspace">
        <header className="app-bar">
          <div className="brand">
            teca<span>движок расстановки артефактов</span>
          </div>
          <div className="app-bar-actions">
            <button type="button" onClick={() => void addBoard()}>
              + Доска
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              Настройки
            </button>
          </div>
        </header>

        {!ready ? (
          <div className="placeholder">Загрузка…</div>
        ) : boards.length === 0 ? (
          <div className="placeholder">
            <p>Досок пока нет.</p>
            <button type="button" className="primary" onClick={() => void addBoard()}>
              Создать первую доску
            </button>
          </div>
        ) : (
          <BoardsStrip />
        )}
      </main>

      <div className="resizer" onPointerDown={() => (dragging.current = true)} />

      <ChatPanel />

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {error && (
        <div className="toast error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
};
