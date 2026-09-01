import type { PublicSettings, Skill } from '@teca/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../state/store';

interface Draft {
  name: string;
  when: string;
  body: string;
}

const emptyDraft: Draft = { name: '', when: '', body: '' };

export const SkillsPanel = ({ settings }: { settings: PublicSettings }) => {
  const saveSettings = useStore((s) => s.saveSettings);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async (keepId?: string | null) => {
    const data = await api.skills();
    setSkills(data.skills);
    const next = data.skills.find((s) => s.id === keepId) ?? data.skills[0] ?? null;
    setSelectedId(next?.id ?? null);
    setDraft(next ? { name: next.name, when: next.when, body: next.body } : emptyDraft);
    setDirty(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const selected = skills.find((s) => s.id === selectedId) ?? null;

  const select = (skill: Skill) => {
    if (dirty && !confirm('Несохранённые правки пропадут. Продолжить?')) return;
    setSelectedId(skill.id);
    setDraft({ name: skill.name, when: skill.when, body: skill.body });
    setDirty(false);
    setStatus(null);
  };

  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateSkill(selected.id, draft);
      await reload(selected.id);
      setStatus('Сохранено');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const skill = await api.addSkill({
        name: 'Новый скилл',
        when: 'Когда применять этот скилл',
        body: '# Новый скилл\n\nОпиши здесь порядок действий для агента.',
      });
      await reload(skill.id);
      setStatus('Скилл создан, опиши его и сохрани');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-form skills">
      <div className="settings-grid">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.skills.enabled}
            onChange={(e) => void saveSettings({ skills: { enabled: e.target.checked } })}
          />
          <span>Агент видит каталог скиллов и может их читать (skill_list, skill_get)</span>
        </label>
      </div>

      <p className="muted">
        Каталог (название и «когда применять») попадает в системный промпт целиком, полный текст
        агент подтягивает вызовом skill_get только под свою задачу.
      </p>

      <div className="skills-layout">
        <aside className="skills-list">
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className={`skill-item ${skill.id === selectedId ? 'active' : ''}`}
              onClick={() => select(skill)}
            >
              <span className="skill-name">
                {skill.name}
                {!skill.enabled && <em> (выключен)</em>}
              </span>
              <span className="skill-slug">{skill.slug}</span>
            </button>
          ))}
          {skills.length === 0 && <p className="muted">Скиллов пока нет.</p>}
          <div className="settings-row">
            <button type="button" onClick={() => void create()} disabled={busy}>
              Новый скилл
            </button>
            <button
              type="button"
              title="Вернуть встроенные скиллы в исходное состояние"
              onClick={async () => {
                if (!confirm('Встроенные скиллы будут перезаписаны исходными. Продолжить?')) return;
                setBusy(true);
                try {
                  await api.restoreSkills();
                  await reload(selectedId);
                  setStatus('Встроенные скиллы восстановлены');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Восстановить встроенные
            </button>
          </div>
        </aside>

        {selected ? (
          <div className="skill-editor">
            <div className="settings-grid">
              <label>
                <span>Название</span>
                <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={async (e) => {
                    await api.updateSkill(selected.id, { enabled: e.target.checked });
                    await reload(selected.id);
                  }}
                />
                <span>Включён</span>
              </label>
            </div>

            <label>
              <span>Когда применять (видно агенту в каталоге)</span>
              <textarea rows={2} value={draft.when} onChange={(e) => edit({ when: e.target.value })} />
            </label>

            <label className="grow">
              <span>Инструкция (markdown)</span>
              <textarea
                className="skill-body"
                rows={18}
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
              />
            </label>

            <div className="settings-row">
              <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
                Сохранить
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Удалить скилл «${selected.name}»?`)) return;
                  setBusy(true);
                  try {
                    await api.deleteSkill(selected.id);
                    await reload(null);
                    setStatus('Скилл удалён');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Удалить
              </button>
              <span className="muted">
                {dirty ? 'Есть несохранённые правки' : (status ?? `slug: ${selected.slug}`)}
              </span>
            </div>
          </div>
        ) : (
          <p className="muted">Выбери скилл слева или создай новый.</p>
        )}
      </div>
    </div>
  );
};
