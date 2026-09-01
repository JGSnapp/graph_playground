import type { PublicSettings } from '@teca/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../state/store';

export const PromptPanel = ({ settings }: { settings: PublicSettings }) => {
  const saveSettings = useStore((s) => s.saveSettings);
  const [prompt, setPrompt] = useState(settings.agent.systemPrompt);
  const [maxIterations, setMaxIterations] = useState(settings.agent.maxIterations);
  const [unlimitedIterations, setUnlimitedIterations] = useState(
    settings.agent.unlimitedIterations ?? false,
  );
  const [providerRetries, setProviderRetries] = useState(settings.agent.providerRetries ?? 3);
  const [temperature, setTemperature] = useState(settings.agent.temperature);
  const [maxTokens, setMaxTokens] = useState(settings.agent.maxTokens ?? 8192);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="settings-form">
      <label className="grow">
        <span>Системный промпт агента</span>
        <textarea rows={16} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      <div className="settings-grid">
        <label className="check">
          <input
            type="checkbox"
            checked={unlimitedIterations}
            onChange={(e) => setUnlimitedIterations(e.target.checked)}
          />
          <span>Без лимита итераций (пока модель вызывает инструменты)</span>
        </label>
        <label>
          <span>Максимум шагов с инструментами</span>
          <input
            type="number"
            min={1}
            max={200}
            value={maxIterations}
            disabled={unlimitedIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
          />
        </label>
        <label>
          <span>Повторы при обрыве провайдера</span>
          <input
            type="number"
            min={0}
            max={10}
            value={providerRetries}
            onChange={(e) => setProviderRetries(Number(e.target.value))}
          />
        </label>
        <label>
          <span>Температура</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>
        <label>
          <span>Лимит токенов ответа</span>
          <input
            type="number"
            min={256}
            max={32768}
            step={256}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="settings-row">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            setStatus('Сохраняю…');
            await saveSettings({
              agent: {
                systemPrompt: prompt,
                maxIterations,
                unlimitedIterations,
                providerRetries,
                temperature,
                maxTokens,
              },
            });
            setStatus('Сохранено');
          }}
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={async () => {
            const { systemPrompt } = await api.defaultPrompt();
            setPrompt(systemPrompt);
            setStatus('Промпт по умолчанию подставлен, не забудьте сохранить');
          }}
        >
          Вернуть промпт по умолчанию
        </button>
        {status && <span className="muted">{status}</span>}
      </div>
    </div>
  );
};
