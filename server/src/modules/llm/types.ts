export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  /** Completion token cap. Defaults to 8192 if omitted. */
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Tokens billed for one provider call. OpenAI-compatible gateways report this
 * on the final stream chunk, and only when `stream_options.include_usage` was
 * asked for. A provider that reports nothing leaves this absent — the numbers
 * are never estimated, because a wrong cost figure is worse than none.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Prompt tokens served from the provider cache, when it reports them. */
  cachedTokens?: number;
  /** Reasoning tokens billed as completion, when the provider separates them. */
  reasoningTokens?: number;
}

export const emptyUsage = (): TokenUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

export const addUsage = (a: TokenUsage, b: TokenUsage | undefined): TokenUsage => {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0) || undefined,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined,
  };
};

/** Shape providers use on the wire; field names differ between gateways. */
export interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export const readUsage = (raw: WireUsage | undefined | null): TokenUsage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = raw.prompt_tokens ?? raw.input_tokens ?? 0;
  const completion = raw.completion_tokens ?? raw.output_tokens ?? 0;
  const total = raw.total_tokens ?? prompt + completion;
  if (prompt === 0 && completion === 0 && total === 0) return null;
  const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_tokens;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    cachedTokens: cached || undefined,
    reasoningTokens: reasoning || undefined,
  };
};

export interface AssistantTurn {
  content: string;
  reasoning: string;
  toolCalls: ProviderToolCall[];
  finishReason: string | null;
  /** Absent when the provider reported no usage for this call. */
  usage?: TokenUsage;
}

export interface StreamHandlers {
  onContent?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}
