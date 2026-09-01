export interface ProviderSettings {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  embeddingModel: string;
}

export interface KnowledgeSettings {
  /** Agents can search the knowledge base. */
  readEnabled: boolean;
  /** Agents can append new records to the knowledge base. */
  writeEnabled: boolean;
  topK: number;
}

export interface AgentSettings {
  systemPrompt: string;
  maxIterations: number;
  /** When true, ignore maxIterations and keep going until the model stops calling tools. */
  unlimitedIterations: boolean;
  /** Retries for transient mid-stream / 5xx / "client should retry" provider errors. */
  providerRetries: number;
  temperature: number;
  /**
   * Cap on completion tokens sent to the provider (`max_tokens` /
   * `max_completion_tokens`). Without this, gateways reserve the model
   * maximum (often 128k) and reject the request on estimated cost.
   */
  maxTokens: number;
}

export interface SkillsSettings {
  /** When off, the catalog leaves the prompt and the skill tools are hidden. */
  enabled: boolean;
}

export interface Settings {
  provider: ProviderSettings;
  agent: AgentSettings;
  knowledge: KnowledgeSettings;
  skills: SkillsSettings;
}

/** API key is never sent back to the client in full. */
export interface PublicSettings extends Omit<Settings, 'provider'> {
  provider: Omit<ProviderSettings, 'apiKey'> & { apiKeySet: boolean };
}

export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
  ownedBy?: string;
}
