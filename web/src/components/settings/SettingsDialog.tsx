import { useState } from 'react';
import { useStore } from '../../state/store';
import { KnowledgePanel } from './KnowledgePanel';
import { ProviderPanel } from './ProviderPanel';
import { PromptPanel } from './PromptPanel';
import { SkillsPanel } from './SkillsPanel';

type Tab = 'provider' | 'prompt' | 'skills' | 'knowledge';

const TABS: { id: Tab; label: string }[] = [
  { id: 'provider', label: 'Провайдер LLM' },
  { id: 'prompt', label: 'Системный промпт' },
  { id: 'skills', label: 'Скиллы' },
  { id: 'knowledge', label: 'База знаний' },
];

export const SettingsDialog = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<Tab>('provider');
  const settings = useStore((s) => s.settings);

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Настройки</h2>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </header>

        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {!settings ? (
            <p className="muted">Загрузка…</p>
          ) : tab === 'provider' ? (
            <ProviderPanel settings={settings} />
          ) : tab === 'prompt' ? (
            <PromptPanel settings={settings} />
          ) : tab === 'skills' ? (
            <SkillsPanel settings={settings} />
          ) : (
            <KnowledgePanel settings={settings} />
          )}
        </div>
      </div>
    </div>
  );
};
