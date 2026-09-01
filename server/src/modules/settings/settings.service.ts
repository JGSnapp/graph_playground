import type { PublicSettings, Settings } from '@teca/shared';
import path from 'node:path';
import { JsonStore } from '../../core/store.js';
import { defaultSettings } from './defaults.js';

export interface SettingsPatch {
  provider?: Partial<Settings['provider']>;
  agent?: Partial<Settings['agent']>;
  knowledge?: Partial<Settings['knowledge']>;
  skills?: Partial<Settings['skills']>;
}

export class SettingsService {
  private readonly store: JsonStore<Settings>;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(dataDir: string) {
    this.store = new JsonStore<Settings>(path.join(dataDir, 'settings.json'), defaultSettings);
    // Fill in keys added by newer versions without wiping user values.
    this.store.update((s) => {
      const defaults = defaultSettings();
      s.provider = { ...defaults.provider, ...s.provider };
      s.agent = { ...defaults.agent, ...s.agent };
      s.knowledge = { ...defaults.knowledge, ...s.knowledge };
      s.skills = { ...defaults.skills, ...s.skills };
      // Stock prompt is persisted on first run; refresh it when the shipped
      // default grew new tool rules and the user has not rewritten it.
      const stockPrefix = 'Ты — движок расстановки артефактов на бесконечной двумерной доске.';
      if (
        s.agent.systemPrompt.startsWith(stockPrefix) &&
        !s.agent.systemPrompt.includes('artifact_rank_placements')
      ) {
        s.agent.systemPrompt = defaults.agent.systemPrompt;
      }
    });
  }

  get(): Settings {
    return this.store.get();
  }

  getPublic(): PublicSettings {
    const { provider, ...rest } = this.store.get();
    const { apiKey, ...safeProvider } = provider;
    return { ...rest, provider: { ...safeProvider, apiKeySet: apiKey.length > 0 } };
  }

  update(patch: SettingsPatch): PublicSettings {
    this.store.update((s) => {
      if (patch.provider) s.provider = { ...s.provider, ...patch.provider };
      if (patch.agent) s.agent = { ...s.agent, ...patch.agent };
      if (patch.knowledge) s.knowledge = { ...s.knowledge, ...patch.knowledge };
      if (patch.skills) s.skills = { ...s.skills, ...patch.skills };
    });
    for (const listener of this.listeners) listener(this.store.get());
    return this.getPublic();
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
