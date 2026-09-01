import type { ModelInfo } from '@teca/shared';
import { HttpError } from '../../core/errors.js';
import type { SettingsService } from '../settings/settings.service.js';
import { FALLBACK_MODELS } from './models.fallback.js';
import { parseSseStream } from './sse.js';
import { readUsage } from './types.js';
import type {
  AssistantTurn,
  ChatRequest,
  ProviderToolCall,
  StreamHandlers,
  WireUsage,
} from './types.js';

interface StreamDelta {
  content?: string | ContentPartLike | ContentPartLike[] | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

type ContentPartLike =
  | string
  | { type?: string; text?: string; content?: string };

/** Normalizes OpenAI / Anthropic-style content fragments into a plain string. */
export const flattenContent = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenContent).join('');
  if (typeof value === 'object') {
    const part = value as { type?: string; text?: string; content?: string; output_text?: string };
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.output_text === 'string') return part.output_text;
  }
  return '';
};

const prettify = (id: string): string =>
  id
    .split(/[-_]/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');

/**
 * GPT-5+ / o-series, the Claude 5 family and a few others reject
 * temperature/top_p: DS Lab answers 400 `invalid_request` if they are sent.
 * The list is a fast path only — `chat` also retries once without sampling
 * params when a 400 comes back, so a new model never becomes unusable.
 */
export const allowsSamplingParams = (model: string): boolean => {
  const normalized = model.toLowerCase();
  const base = normalized.includes('/') ? (normalized.split('/').pop() ?? normalized) : normalized;
  if (base.startsWith('gpt-5')) return false;
  if (/^o\d/.test(base)) return false;
  if (/^claude-(opus|sonnet|fable|haiku)-5/.test(base)) return false;
  if (base.includes('claude-opus-4-7') || base.includes('claude-opus-4-8')) return false;
  if (base.startsWith('kimi-k3')) return false;
  return true;
};

const DEFAULT_MAX_TOKENS = 8192;

/** GPT-5 / o-series expect `max_completion_tokens`; others use `max_tokens`. */
export const usesCompletionTokenLimit = (model: string): boolean => {
  const normalized = model.toLowerCase();
  const base = normalized.includes('/') ? (normalized.split('/').pop() ?? normalized) : normalized;
  return base.startsWith('gpt-5') || /^o\d/.test(base);
};

/** Fields that cap completion length so the gateway does not reserve 128k. */
export const completionLimitFields = (
  model: string,
  maxTokens: number,
): Record<string, number> => {
  const cap = Math.max(1, Math.floor(maxTokens));
  // Always send `max_tokens` — DS Lab's cost estimator reads it.
  // GPT-5 / o-series also get `max_completion_tokens` (OpenAI convention).
  if (usesCompletionTokenLimit(model)) {
    return { max_tokens: cap, max_completion_tokens: cap };
  }
  return { max_tokens: cap };
};

const jsonSafeReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
};

/** Keep only the OpenAI function-call fields; extra keys make some gateways 400. */
export const canonicalizeToolCall = (
  call: { id?: string; type?: string; function?: { name?: string; arguments?: string } },
  index: number,
): ProviderToolCall => ({
  id: call.id && call.id.length > 0 ? call.id : `call_${index}`,
  type: 'function',
  function: {
    name: call.function?.name ?? '',
    arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : '{}',
  },
});

/** Deltas plus a terminal `message.tool_calls` would otherwise duplicate every call. */
export const mergeToolCalls = (
  streamed: Map<number, ProviderToolCall>,
  fromMessage?: ProviderToolCall[] | null,
): ProviderToolCall[] => {
  const source =
    streamed.size > 0
      ? [...streamed.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, call], index) => canonicalizeToolCall(call, index))
      : (fromMessage ?? []).map((call, index) => canonicalizeToolCall(call, index));

  const seen = new Set<string>();
  const unique: ProviderToolCall[] = [];
  for (const call of source) {
    if (!call.function.name || seen.has(call.id)) continue;
    seen.add(call.id);
    unique.push(call);
  }
  return unique;
};

type WireMessage = Record<string, unknown>;

/** Drop fields the gateway does not list in its schema (e.g. tool `name`). */
export const toWireMessages = (messages: ChatRequest['messages']): WireMessage[] =>
  messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      };
    }
    const wire: WireMessage = { role: message.role };
    if (message.tool_calls?.length) {
      wire.content = message.content ?? null;
      wire.tool_calls = message.tool_calls.map((call, index) => canonicalizeToolCall(call, index));
      return wire;
    }
    wire.content = message.content ?? '';
    return wire;
  });

export const buildChatBody = (request: ChatRequest): Record<string, unknown> => {
  const includeTemperature = request.temperature != null && allowsSamplingParams(request.model);
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  return {
    model: request.model,
    messages: toWireMessages(request.messages),
    stream: true,
    // Without this an OpenAI-compatible stream never reports token counts.
    // Gateways that do not know the field ignore it.
    stream_options: { include_usage: true },
    ...completionLimitFields(request.model, maxTokens),
    ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
    ...(includeTemperature ? { temperature: request.temperature } : {}),
  };
};

/**
 * Thin client for any OpenAI-compatible endpoint (defaults to DS Lab).
 * The whole rest of the system only talks to the LLM through this class.
 */
export class LlmProvider {
  private modelCache: { at: number; models: ModelInfo[] } | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    settings.onChange(() => {
      this.modelCache = null;
    });
  }

  private config() {
    const { provider } = this.settings.get();
    return {
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      apiKey: provider.apiKey,
      embeddingModel: provider.embeddingModel,
    };
  }

  get configured(): boolean {
    return this.config().apiKey.length > 0;
  }

  private headers(): Record<string, string> {
    const { apiKey } = this.config();
    return {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  async listModels(force = false): Promise<{ models: ModelInfo[]; source: 'api' | 'fallback' }> {
    if (!force && this.modelCache && Date.now() - this.modelCache.at < 5 * 60_000) {
      return { models: this.modelCache.models, source: 'api' };
    }
    const { baseUrl } = this.config();
    try {
      const res = await this.fetchImpl(`${baseUrl}/models`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const models: ModelInfo[] = (body.data ?? [])
        .map((m) => {
          const id = String(m.id ?? '');
          return {
            id,
            label: typeof m.name === 'string' && m.name ? m.name : prettify(id),
            description: typeof m.description === 'string' ? m.description : undefined,
            ownedBy: typeof m.owned_by === 'string' ? m.owned_by : undefined,
          };
        })
        .filter((m) => m.id.length > 0);
      if (models.length === 0) throw new Error('empty model list');
      this.modelCache = { at: Date.now(), models };
      return { models, source: 'api' };
    } catch {
      return { models: FALLBACK_MODELS, source: 'fallback' };
    }
  }

  async embed(inputs: string[]): Promise<number[][]> {
    const { baseUrl, embeddingModel } = this.config();
    const res = await this.fetchImpl(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: embeddingModel, input: inputs }),
    });
    if (!res.ok) {
      throw new HttpError(res.status, `Embeddings request failed: ${await res.text()}`);
    }
    const body = (await res.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
    const rows = body.data ?? [];
    if (rows.length !== inputs.length) throw new Error('Embedding count mismatch');
    return rows
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => row.embedding);
  }

  /** Streams a chat completion and returns the fully accumulated assistant turn. */
  async chat(request: ChatRequest, handlers: StreamHandlers = {}): Promise<AssistantTurn> {
    const { baseUrl, apiKey } = this.config();
    if (!apiKey) {
      throw new HttpError(400, 'LLM API key is not configured. Open Settings → Provider.');
    }
    if (request.signal?.aborted) {
      throw new HttpError(499, 'LLM request aborted before start');
    }

    const send = (body: Record<string, unknown>) =>
      this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify(body, jsonSafeReplacer),
      });

    const wire = buildChatBody(request);
    let res = await send(wire);

    // Gateways reject sampling params per model and the list changes with every
    // new release. One blind retry without them is cheaper than a dead model.
    if (res.status === 400 && wire.temperature != null) {
      const { temperature: _dropped, ...withoutSampling } = wire;
      res = await send(withoutSampling);
    }

    if (!res.ok || !res.body) {
      const text = res.body ? await res.text() : '';
      throw new HttpError(res.status || 502, `LLM request failed (${res.status}): ${text}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    // Some gateways ignore stream:true and return a single JSON object.
    if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
      const body = (await res.json()) as {
        error?: { message?: string };
        usage?: WireUsage;
        choices?: Array<{
          message?: { content?: unknown; reasoning_content?: string; tool_calls?: ProviderToolCall[] };
          finish_reason?: string | null;
        }>;
      };
      if (body.error) throw new HttpError(502, body.error.message ?? 'LLM error');
      const choice = body.choices?.[0];
      const content = flattenContent(choice?.message?.content);
      const reasoning = choice?.message?.reasoning_content ?? '';
      if (content) handlers.onContent?.(content);
      if (reasoning) handlers.onReasoning?.(reasoning);
      return {
        content,
        reasoning,
        toolCalls: mergeToolCalls(new Map(), choice?.message?.tool_calls ?? []),
        finishReason: choice?.finish_reason ?? null,
        usage: readUsage(body.usage) ?? undefined,
      };
    }

    const turn: AssistantTurn = {
      content: '',
      reasoning: '',
      toolCalls: [],
      finishReason: null,
    };
    const partials = new Map<number, ProviderToolCall>();
    let sawChunk = false;
    let messageToolCalls: ProviderToolCall[] | null = null;

    for await (const raw of parseSseStream(res.body)) {
      sawChunk = true;
      const chunk = raw as {
        choices?: Array<{
          delta?: StreamDelta;
          message?: { content?: unknown; reasoning_content?: string; tool_calls?: ProviderToolCall[] };
          finish_reason?: string | null;
        }>;
        usage?: WireUsage;
        error?: { message?: string };
      };
      if (chunk.error) throw new HttpError(502, chunk.error.message ?? 'LLM stream error');
      // The usage chunk normally carries an empty `choices`, so read it before
      // the early return below.
      const reported = readUsage(chunk.usage);
      if (reported) turn.usage = reported;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) turn.finishReason = choice.finish_reason;

      // Some providers emit a full `message` on the terminal chunk instead of deltas.
      if (choice.message) {
        const content = flattenContent(choice.message.content);
        if (content) {
          turn.content += content;
          handlers.onContent?.(content);
        }
        const reasoning = choice.message.reasoning_content ?? '';
        if (reasoning) {
          turn.reasoning += reasoning;
          handlers.onReasoning?.(reasoning);
        }
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          messageToolCalls = choice.message.tool_calls;
        }
      }

      const delta = choice.delta;
      if (!delta) continue;

      const content = flattenContent(delta.content);
      if (content) {
        turn.content += content;
        handlers.onContent?.(content);
      }
      const reasoning = flattenContent(delta.reasoning ?? delta.reasoning_content);
      if (reasoning) {
        turn.reasoning += reasoning;
        handlers.onReasoning?.(reasoning);
      }
      for (const tc of delta.tool_calls ?? []) {
        const existing = partials.get(tc.index) ?? {
          id: tc.id ?? `call_${tc.index}`,
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        partials.set(tc.index, existing);
      }
    }

    if (!sawChunk) {
      throw new HttpError(502, 'LLM returned an empty stream. Check model id and provider URL.');
    }

    turn.toolCalls = mergeToolCalls(partials, messageToolCalls);
    return turn;
  }

  /**
   * One-shot probe used by /api/debug/llm — never returns the API key, only the
   * shape of the upstream response so empty-agent failures are diagnosable.
   */
  async probe(model: string): Promise<Record<string, unknown>> {
    const { baseUrl, apiKey } = this.config();
    if (!apiKey) return { ok: false, error: 'API key is not configured' };

    const started = Date.now();
    const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        stream: true,
        max_tokens: 32,
      }),
    });
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const dataLines = raw.split(/\n/).filter((line) => line.startsWith('data:'));
    const sample = dataLines.slice(0, 4).map((line) => line.slice(0, 240));
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      elapsedMs: Date.now() - started,
      dataLineCount: dataLines.length,
      sample,
      bodyPreview: raw.slice(0, 400),
    };
  }
}
