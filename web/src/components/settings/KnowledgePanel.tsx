import type { KnowledgeEntry, KnowledgeHit, KnowledgeStats, PublicSettings } from '@teca/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../state/store';

export const KnowledgePanel = ({ settings }: { settings: PublicSettings }) => {
  const saveSettings = useStore((s) => s.saveSettings);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [draft, setDraft] = useState({ title: '', text: '', tags: '' });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const data = await api.knowledge();
    setEntries(data.entries);
    setStats(data.stats);
  };

  useEffect(() => {
    void reload();
  }, []);

  const search = async () => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setBusy(true);
    try {
      const result = await api.searchKnowledge(query, 8);
      setHits(result.hits);
      setStats(result.stats);
    } finally {
      setBusy(false);
    }
  };

  const shown = hits ?? entries;

  return (
    <div className="settings-form knowledge">
      <div className="settings-grid">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.knowledge.readEnabled}
            onChange={(e) => void saveSettings({ knowledge: { readEnabled: e.target.checked } })}
          />
          <span>Агент может искать в базе (kb_search)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.knowledge.writeEnabled}
            disabled={!settings.knowledge.readEnabled}
            onChange={(e) => void saveSettings({ knowledge: { writeEnabled: e.target.checked } })}
          />
          <span>Агент может добавлять записи (kb_add)</span>
        </label>
        <label>
          <span>Записей в выдаче по умолчанию</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.knowledge.topK}
            onChange={(e) => void saveSettings({ knowledge: { topK: Number(e.target.value) } })}
          />
        </label>
      </div>

      {stats && (
        <p className="muted">
          {stats.entries} записей · размерность {stats.dimensions} ·{' '}
          {stats.remoteEmbeddings ? `эмбеддинги провайдера (${stats.embeddingModel})` : 'локальные эмбеддинги'}
        </p>
      )}

      <div className="settings-row">
        <input
          className="grow"
          placeholder="Семантический поиск по базе…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button type="button" onClick={() => void search()} disabled={busy}>
          Найти
        </button>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setHits(null);
          }}
        >
          Сброс
        </button>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              const { stats: next } = await api.reindexKnowledge();
              setStats(next);
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          Переиндексировать
        </button>
      </div>

      <div className="kb-list">
        {shown.map((entry) => (
          <div key={entry.id} className="kb-entry">
            <div className="kb-entry-head">
              <strong>{entry.title}</strong>
              <span className="kb-source">{entry.source}</span>
              {'score' in entry && <span className="kb-score">{(entry as KnowledgeHit).score.toFixed(3)}</span>}
              <button
                type="button"
                onClick={async () => {
                  await api.deleteKnowledge(entry.id);
                  setHits(null);
                  await reload();
                }}
              >
                ×
              </button>
            </div>
            <p>{entry.text}</p>
            <div className="kb-tags">
              {entry.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
          </div>
        ))}
        {shown.length === 0 && <p className="muted">Ничего не найдено.</p>}
      </div>

      <div className="kb-add">
        <input
          placeholder="Заголовок"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          placeholder="Текст записи"
          rows={3}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <div className="settings-row">
          <input
            className="grow"
            placeholder="теги через запятую"
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
          <button
            type="button"
            className="primary"
            disabled={!draft.title.trim() || !draft.text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.addKnowledge({
                  title: draft.title,
                  text: draft.text,
                  tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
                });
                setDraft({ title: '', text: '', tags: '' });
                setHits(null);
                await reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить запись
          </button>
        </div>
      </div>
    </div>
  );
};
