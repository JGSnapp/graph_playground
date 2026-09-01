import type { PublicSettings } from '@teca/shared';
import { useState } from 'react';
import { useStore } from '../../state/store';

export const ProviderPanel = ({ settings }: { settings: PublicSettings }) => {
  const models = useStore((s) => s.models);
  const modelSource = useStore((s) => s.modelSource);
  const saveSettings = useStore((s) => s.saveSettings);
  const refreshModels = useStore((s) => s.refreshModels);

  const [baseUrl, setBaseUrl] = useState(settings.provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(settings.provider.defaultModel);
  const [embeddingModel, setEmbeddingModel] = useState(settings.provider.embeddingModel);
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    setStatus('Сохраняю…');
    try {
      await saveSettings({
        provider: {
          baseUrl,
          defaultModel,
          embeddingModel,
          ...(apiKey ? { apiKey } : {}),
        },
      });
      setApiKey('');
      setStatus('Сохранено');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Ошибка');
    }
  };

  return (
    <div className="settings-form">
      <label>
        <span>Base URL</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.dslab.tech/v1" />
      </label>

      <label>
        <span>
          API key {settings.provider.apiKeySet ? <em className="ok">ключ сохранён</em> : <em className="warn">не задан</em>}
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings.provider.apiKeySet ? '•••••••• (оставьте пустым, чтобы не менять)' : 'sk-…'}
        />
      </label>

      <label>
        <span>Модель по умолчанию для новых досок</span>
        <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
          {!models.some((m) => m.id === defaultModel) && <option value={defaultModel}>{defaultModel}</option>}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — {model.id}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Модель эмбеддингов для базы знаний</span>
        <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
      </label>

      <div className="settings-row">
        <button type="button" className="primary" onClick={() => void save()}>
          Сохранить
        </button>
        <button type="button" onClick={() => void refreshModels(true)}>
          Обновить список моделей
        </button>
        <span className="muted">
          {models.length} моделей · источник: {modelSource === 'api' ? 'API провайдера' : 'встроенный список'}
        </span>
        {status && <span className="muted">{status}</span>}
      </div>
    </div>
  );
};
