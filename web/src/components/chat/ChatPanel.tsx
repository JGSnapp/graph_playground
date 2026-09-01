import type { ChatMessage } from '@teca/shared';
import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { Composer } from './Composer';
import { MessageView } from './MessageView';

/** Stable identity: returning a fresh [] from the selector would re-render forever. */
const NO_MESSAGES: ChatMessage[] = [];

export const ChatPanel = () => {
  const activeBoardId = useStore((s) => s.activeBoardId);
  const board = useStore((s) => s.boards.find((b) => b.id === s.activeBoardId) ?? null);
  const messages = useStore((s) =>
    s.activeBoardId ? (s.messages[s.activeBoardId] ?? NO_MESSAGES) : NO_MESSAGES,
  );
  const running = useStore((s) => Boolean(s.activeBoardId && s.runs[s.activeBoardId]));
  const streamStatus = useStore((s) =>
    s.activeBoardId ? (s.streamStatus[s.activeBoardId] ?? null) : null,
  );
  const models = useStore((s) => s.models);
  const { send, stop, clearChat, setBoardModel } = useStore();

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, streamStatus]);

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <div className="chat-title">
          <span className="label">Чат с агентом</span>
          <strong>{board?.title ?? 'нет доски'}</strong>
          {streamStatus && <span className="stream-status">{streamStatus}</span>}
        </div>
        {board && (
          <div className="chat-header-actions">
            <select
              className="model-select"
              value={board.model}
              title="Модель для следующего запроса"
              onChange={(e) => void setBoardModel(board.id, e.target.value)}
            >
              {!models.some((m) => m.id === board.model) && (
                <option value={board.model}>{board.model}</option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <button type="button" title="Очистить историю" onClick={() => void clearChat(board.id)}>
              ⌫
            </button>
          </div>
        )}
      </header>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Опишите гипотезу расстановки — агент выполнит её на доске.</p>
            <ul>
              <li>«Собери схему пайплайна из пяти блоков и соедини стрелками»</li>
              <li>«Найди в базе знаний факты про Studio Ghibli и разложи заметками»</li>
              <li>«Посмотри на доску и выровняй артефакты по сетке»</li>
            </ul>
          </div>
        )}
        {messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}
      </div>

      <Composer
        disabled={!activeBoardId}
        running={running}
        onSend={(text, attachments) => {
          if (!activeBoardId) return;
          void send(activeBoardId, text, attachments, board?.model);
        }}
        onStop={() => activeBoardId && stop(activeBoardId)}
      />
    </aside>
  );
};
