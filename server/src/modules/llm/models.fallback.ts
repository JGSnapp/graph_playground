import type { ModelInfo } from '@teca/shared';

/**
 * Shown before an API key is configured (or when the catalog endpoint is down),
 * so the model picker is never empty. The live list always wins.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Флагманская модель OpenAI для сложных задач' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Сбалансированная модель OpenAI' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Быстрая и доступная модель OpenAI' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', description: 'Флагман Anthropic для сложных задач' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Быстрая модель Anthropic для кода и агентов' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Anthropic для долгих агентных задач' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'Быстрая мультимодальная модель Google' },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', description: 'Флагман Google с контекстом 1M' },
  { id: 'grok-4.5', label: 'Grok 4.5', description: 'Флагманская модель xAI для кода и агентов' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Флагман DeepSeek, контекст 1M' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Лёгкая модель DeepSeek для агентов' },
  { id: 'qwen3.8-max', label: 'Qwen3.8 Max', description: 'Флагман Alibaba Cloud' },
  { id: 'kimi-k3', label: 'Kimi K3', description: 'Moonshot AI с ризонингом и 1M контекстом' },
  { id: 'glm-5.2', label: 'GLM-5.2', description: 'Флагман Zhipu AI, контекст 1M' },
  { id: 'minimax-m3', label: 'MiniMax M3', description: 'Мультимодальная модель MiniMax' },
];

export const FALLBACK_EMBEDDING_MODELS: ModelInfo[] = [
  { id: 'text-embedding-3-small', label: 'Text Embedding 3 Small' },
  { id: 'text-embedding-3-large', label: 'Text Embedding 3 Large' },
  { id: 'qwen3-embedding-8b', label: 'Qwen3 Embedding 8B' },
  { id: 'gemini-embedding-2', label: 'Gemini Embedding 2' },
  { id: 'mistral-embed', label: 'Mistral Embed' },
  { id: 'gte-base', label: 'GTE Base' },
];
