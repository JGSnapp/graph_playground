import {
  boardQuality,
  type AgentEvent,
  type Attachment,
  type BoardState,
  type ChatMessage,
  type ToolCallRecord,
} from '@teca/shared';
import { newId } from '../../core/ids.js';
import type { BoardsService } from '../boards/boards.service.js';
import type { ChatsService } from '../chat/chats.service.js';
import type { KnowledgeService } from '../knowledge/knowledge.service.js';
import type { LlmProvider } from '../llm/provider.js';
import { isRetryableProviderError, retryDelayMs, sleep } from '../llm/retry.js';
import { addUsage, emptyUsage } from '../llm/types.js';
import type { AssistantTurn, ProviderMessage, ProviderToolCall } from '../llm/types.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { SkillsService } from '../skills/skills.service.js';
import { historyMessages, systemMessage, userMessage } from './prompt.js';
import {
  type AgentRunLog,
  type RunCheckpointLog,
  type RunIterationLog,
  type RunQualitySnapshot,
  type RunTerminationReason,
  type RunToolLog,
  RunLogsService,
} from './run-logs.service.js';
import type { ScreenshotBroker } from './screenshots.js';
import { ToolRegistry } from './tools/index.js';
import { validateArgs } from './tools/validate.js';

const MAX_TOOL_RESULT_CHARS = 8000;
/** Hard ceiling when "unlimited" is on, so a runaway tool loop can still be stopped. */
const UNLIMITED_SOFT_CAP = 500;

const jsonSafe = (_key: string, value: unknown): unknown => {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
};

/** Tool content must itself be valid JSON — some gateways parse it and 400 on a mid-cut string. */
export const stringifyToolResult = (data: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string => {
  const json = JSON.stringify(data ?? null, jsonSafe);
  if (json.length <= maxChars) return json;
  return JSON.stringify({
    truncated: true,
    chars: json.length,
    preview: json.slice(0, Math.max(0, maxChars - 120)),
  });
};

export interface RunInput {
  boardId: string;
  text: string;
  attachments?: Attachment[];
  model?: string;
}

const parseArguments = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' };
  }
};

const stringifyResult = (data: unknown): string => stringifyToolResult(data);

interface TrackedCheckpoint {
  log: RunCheckpointLog;
  state: BoardState;
}

interface ToolExecution {
  messages: ProviderMessage[];
  audit: RunToolLog;
}

const refusalReason = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (payload.refused !== true) return null;
  if (typeof payload.reason === 'string' && payload.reason.trim()) return payload.reason;
  if (typeof payload.verdict === 'string' && payload.verdict.trim()) return payload.verdict;
  return 'Инструмент отказался выполнить действие.';
};

/**
 * The agent loop: stream a completion, execute any requested tools against the
 * board, feed the results back, repeat until the model answers without tools.
 */
export class AgentService {
  constructor(
    private readonly boards: BoardsService,
    private readonly chats: ChatsService,
    private readonly knowledge: KnowledgeService,
    private readonly skills: SkillsService,
    private readonly settingsService: SettingsService,
    private readonly provider: LlmProvider,
    private readonly screenshots: ScreenshotBroker,
    private readonly runLogs: RunLogsService,
    private readonly registry: ToolRegistry = new ToolRegistry(),
  ) {}

  private qualitySnapshot(boardId: string): RunQualitySnapshot {
    return this.boards.read(boardId, (state) => {
      const quality = boardQuality(state.artifacts, state.arrows);
      return {
        score: quality.score,
        cost: quality.cost,
        grade: quality.grade,
        counts: quality.counts,
        artifactCount: state.artifacts.length,
        arrowCount: state.arrows.length,
      };
    });
  }

  async run(
    input: RunInput,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<ChatMessage> {
    const runId = newId('run');
    const settings = this.settingsService.get();
    const model = input.model || this.boards.get(input.boardId).model;
    if (model !== this.boards.get(input.boardId).model) {
      this.boards.updateMeta(input.boardId, { model });
    }
    emit({ type: 'run_start', runId, boardId: input.boardId, model });

    const history = historyMessages(this.chats.list(input.boardId));

    const userRecord: ChatMessage = {
      id: newId('msg'),
      boardId: input.boardId,
      role: 'user',
      content: input.text,
      attachments: input.attachments,
      createdAt: Date.now(),
    };
    this.chats.append(userRecord);
    emit({ type: 'message_end', message: userRecord });

    const assistant: ChatMessage = {
      id: newId('msg'),
      boardId: input.boardId,
      role: 'assistant',
      content: '',
      reasoning: '',
      toolCalls: [],
      model,
      createdAt: Date.now(),
    };
    this.chats.append(assistant);
    emit({ type: 'message_start', message: assistant });

    const conversation: ProviderMessage[] = [
      systemMessage(this.boards.get(input.boardId), settings, this.skills.catalog()),
      ...history,
      userMessage(input.text, input.attachments),
    ];

    const iterationLimit = settings.agent.unlimitedIterations
      ? UNLIMITED_SOFT_CAP
      : Math.max(1, settings.agent.maxIterations);
    const providerRetries = Math.max(0, settings.agent.providerRetries ?? 3);

    const initialQuality = this.qualitySnapshot(input.boardId);
    let best: TrackedCheckpoint = {
      state: this.boards.snapshot(input.boardId),
      log: {
        checkpointId: `${runId}:initial`,
        iteration: 0,
        capturedAt: Date.now(),
        quality: initialQuality,
      },
    };
    const runLog: AgentRunLog = {
      runId,
      boardId: input.boardId,
      model,
      startedAt: Date.now(),
      status: 'running',
      refusalStatus: 'none',
      refusalReasons: [],
      iterations: [],
      usage: { ...emptyUsage(), calls: 0, callsWithoutUsage: 0 },
      bestCheckpoint: best.log,
    };
    this.runLogs.start(runLog);

    /** Folds one provider call into the run total and the current iteration. */
    const recordUsage = (turn: AssistantTurn, iteration: RunIterationLog | undefined) => {
      if (!turn.usage) {
        runLog.usage.callsWithoutUsage += 1;
        return;
      }
      const merged = addUsage(runLog.usage, turn.usage);
      runLog.usage = { ...runLog.usage, ...merged, calls: runLog.usage.calls + 1 };
      if (iteration) iteration.usage = addUsage(iteration.usage ?? emptyUsage(), turn.usage);
    };

    const isBetterCheckpoint = (candidate: RunQualitySnapshot, current: RunQualitySnapshot) => {
      // On a failed run, structural completeness outranks a deceptively cheap
      // state produced by deleting nodes or edges. Quality breaks ties only
      // between checkpoints with the same amount of graph data.
      if (candidate.artifactCount !== current.artifactCount) {
        return candidate.artifactCount > current.artifactCount;
      }
      if (candidate.arrowCount !== current.arrowCount) {
        return candidate.arrowCount > current.arrowCount;
      }
      return candidate.cost <= current.cost;
    };

    const captureCheckpoint = (iteration: number, toolCallId: string) => {
      const quality = this.qualitySnapshot(input.boardId);
      if (!isBetterCheckpoint(quality, best.log.quality)) return;
      best = {
        state: this.boards.snapshot(input.boardId),
        log: {
          checkpointId: `${runId}:${iteration}:${toolCallId}`,
          iteration,
          toolCallId,
          capturedAt: Date.now(),
          quality,
        },
      };
      this.runLogs.update(runId, (log) => {
        log.bestCheckpoint = best.log;
      });
    };

    let completed = false;
    let terminationReason: RunTerminationReason | undefined;
    let terminationMessage: string | undefined;
    let restoredBestCheckpoint: RunCheckpointLog | undefined;
    let activeIteration: RunIterationLog | undefined;

    try {
      for (let iterationIndex = 0; iterationIndex < iterationLimit; iterationIndex++) {
        if (signal.aborted) {
          throw new Error('Запрос прерван (соединение с клиентом закрыто).');
        }

        const iteration = iterationIndex + 1;
        activeIteration = {
          iteration,
          startedAt: Date.now(),
          qualityBefore: this.qualitySnapshot(input.boardId),
          refusalStatus: 'none',
          refusalReasons: [],
          toolCalls: [],
        };
        this.runLogs.update(runId, (log) => {
          log.iterations.push(activeIteration!);
        });

        const turn = await this.chatWithRetries({
          model,
          conversation,
          temperature: settings.agent.temperature,
          maxTokens: settings.agent.maxTokens ?? 8192,
          retries: providerRetries,
          signal,
          assistant,
          emit,
        });

        recordUsage(turn, activeIteration);

        if (!assistant.content && turn.content) assistant.content = turn.content;
        if (!assistant.reasoning && turn.reasoning) assistant.reasoning = turn.reasoning;

        if (turn.toolCalls.length === 0) {
          activeIteration.qualityAfter = this.qualitySnapshot(input.boardId);
          activeIteration.finishedAt = Date.now();
          this.runLogs.update(runId, () => undefined);
          activeIteration = undefined;
          completed = true;
          terminationReason = 'completed';
          break;
        }

        conversation.push({
          role: 'assistant',
          content: turn.content || null,
          tool_calls: turn.toolCalls,
        });

        for (const call of turn.toolCalls) {
          const execution = await this.executeTool(call, assistant, input.boardId, emit, signal);
          conversation.push(...execution.messages);
          activeIteration.toolCalls.push(execution.audit);
          if (execution.audit.refused) {
            activeIteration.refusalStatus = 'refused';
            if (execution.audit.refusalReason) {
              activeIteration.refusalReasons.push(execution.audit.refusalReason);
              if (!runLog.refusalReasons.includes(execution.audit.refusalReason)) {
                runLog.refusalReasons.push(execution.audit.refusalReason);
              }
            }
            runLog.refusalStatus = 'encountered';
          }
          if (execution.audit.mutated) captureCheckpoint(iteration, call.id);
          this.runLogs.update(runId, () => undefined);
        }

        activeIteration.qualityAfter = this.qualitySnapshot(input.boardId);
        activeIteration.finishedAt = Date.now();
        this.runLogs.update(runId, () => undefined);
        activeIteration = undefined;
      }

      if (!completed) {
        const current = this.boards.snapshot(input.boardId);
        if (JSON.stringify(current) !== JSON.stringify(best.state)) {
          this.boards.restoreState(input.boardId, best.state);
          emit({ type: 'board_updated', board: this.boards.get(input.boardId) });
        }
        restoredBestCheckpoint = { ...best.log, restoredAt: Date.now() };
        terminationReason = 'iteration_limit';
        terminationMessage = settings.agent.unlimitedIterations
          ? `Достигнут защитный лимит ${iterationLimit} итераций.`
          : `Достигнут лимит ${iterationLimit} итераций.`;
        assistant.error =
          `${terminationMessage} Выполнение остановлено; восстановлен лучший полный снимок доски ` +
          `(итерация ${best.log.iteration}, качество ${best.log.quality.score}/100, ` +
          `${best.log.quality.artifactCount} блоков, ${best.log.quality.arrowCount} связей).`;
        emit({ type: 'error', message: assistant.error });
      }

      if (
        !assistant.content &&
        !assistant.reasoning &&
        !(assistant.toolCalls?.length) &&
        !assistant.error
      ) {
        assistant.error =
          'Модель вернула пустой ответ. Проверьте id модели и ключ провайдера (Настройки → Провайдер).';
        terminationReason = 'empty_response';
        terminationMessage = assistant.error;
        emit({ type: 'error', message: assistant.error });
      }
    } catch (error) {
      if (activeIteration && !activeIteration.finishedAt) {
        activeIteration.qualityAfter = this.qualitySnapshot(input.boardId);
        activeIteration.finishedAt = Date.now();
      }
      const message = error instanceof Error ? error.message : String(error);
      const aborted =
        signal.aborted ||
        (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message)));
      assistant.error = aborted
        ? 'Запрос прерван до получения ответа. Попробуйте отправить ещё раз.'
        : message;
      terminationReason = aborted ? 'aborted' : 'provider_error';
      terminationMessage = assistant.error;
      emit({ type: 'error', message: assistant.error });
    }

    this.runLogs.update(runId, (log) => {
      log.status = 'finished';
      log.finishedAt = Date.now();
      log.terminationReason = terminationReason ?? 'provider_error';
      log.terminationMessage = terminationMessage;
      log.usage = runLog.usage;
      log.bestCheckpoint = best.log;
      log.restoredBestCheckpoint = restoredBestCheckpoint;
    });

    // A run where the provider never reported usage carries no numbers at all,
    // rather than a misleading zero.
    if (runLog.usage.calls > 0) assistant.usage = runLog.usage;

    this.chats.touch();
    emit({ type: 'message_end', message: assistant });
    emit({ type: 'run_end', runId });
    return assistant;
  }

  /**
   * Retries transient mid-stream / gateway failures. Partial tokens from a
   * failed attempt are rolled back so the client does not keep a broken draft.
   */
  private async chatWithRetries(args: {
    model: string;
    conversation: ProviderMessage[];
    temperature: number;
    maxTokens: number;
    retries: number;
    signal: AbortSignal;
    assistant: ChatMessage;
    emit: (event: AgentEvent) => void;
  }): Promise<AssistantTurn> {
    const { model, conversation, temperature, maxTokens, retries, signal, assistant, emit } = args;
    const contentBefore = assistant.content;
    const reasoningBefore = assistant.reasoning ?? '';
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal.aborted) throw new Error('aborted');

      // Roll back any tokens streamed during a previous failed attempt.
      if (attempt > 0) {
        assistant.content = contentBefore;
        assistant.reasoning = reasoningBefore;
        emit({ type: 'content_replace', messageId: assistant.id, content: contentBefore });
        emit({ type: 'reasoning_replace', messageId: assistant.id, reasoning: reasoningBefore });
        emit({
          type: 'status',
          message: `Провайдер оборвал поток — повтор ${attempt}/${retries}…`,
        });
        await sleep(retryDelayMs(attempt), signal);
      }

      try {
        return await this.provider.chat(
          {
            model,
            messages: conversation,
            tools: this.registry.definitions(this.settingsService.get()),
            temperature,
            maxTokens,
            signal,
          },
          {
            onContent: (delta) => {
              assistant.content += delta;
              emit({ type: 'content_delta', messageId: assistant.id, delta });
            },
            onReasoning: (delta) => {
              assistant.reasoning = (assistant.reasoning ?? '') + delta;
              emit({ type: 'reasoning_delta', messageId: assistant.id, delta });
            },
          },
        );
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderError(error) || attempt >= retries) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async executeTool(
    call: ProviderToolCall,
    assistant: ChatMessage,
    boardId: string,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<ToolExecution> {
    const settings = this.settingsService.get();
    const qualityBefore = this.qualitySnapshot(boardId);
    const record: ToolCallRecord = {
      id: call.id,
      name: call.function.name,
      args: undefined,
      status: 'running',
      startedAt: Date.now(),
    };
    assistant.toolCalls = [...(assistant.toolCalls ?? []), record];

    const fail = (message: string): ToolExecution => {
      record.status = 'error';
      record.error = message;
      record.finishedAt = Date.now();
      emit({ type: 'tool_result', messageId: assistant.id, toolCall: record });
      return {
        messages: [
          { role: 'tool', tool_call_id: call.id, name: call.function.name, content: `Ошибка: ${message}` },
        ],
        audit: {
          callId: call.id,
          name: call.function.name,
          status: 'error',
          refused: false,
          mutated: false,
          qualityBefore,
          qualityAfter: this.qualitySnapshot(boardId),
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
        },
      };
    };

    const tool = this.registry.get(call.function.name);
    const parsed = parseArguments(call.function.arguments);
    record.args = parsed.ok ? parsed.value : call.function.arguments;
    emit({ type: 'tool_call', messageId: assistant.id, toolCall: record });

    if (!tool) return fail(`Неизвестный инструмент ${call.function.name}`);
    if (!(tool.isEnabled?.(settings) ?? true)) {
      return fail(`Инструмент ${tool.name} отключён в настройках`);
    }
    if (!parsed.ok) return fail(`Не удалось разобрать аргументы: ${parsed.error}`);

    const validation = validateArgs(tool.parameters, parsed.value);
    if (!validation.ok) return fail(validation.errors.join('; '));
    record.args = validation.value;

    try {
      const result = await tool.run(validation.value, {
        boardId,
        boards: this.boards,
        knowledge: this.knowledge,
        skills: this.skills,
        settings,
        screenshots: this.screenshots,
        emit,
        signal,
      });

      const refusal = refusalReason(result.data);
      record.status = refusal ? 'refused' : 'done';
      record.result = result.data;
      record.refusalReason = refusal ?? undefined;
      record.finishedAt = Date.now();
      emit({ type: 'tool_result', messageId: assistant.id, toolCall: record });
      const mutated = result.mutated === true && refusal == null;
      if (mutated) emit({ type: 'board_updated', board: this.boards.get(boardId) });

      const messages: ProviderMessage[] = [
        {
          role: 'tool',
          tool_call_id: call.id,
          name: tool.name,
          content: refusal
            ? stringifyResult({ status: 'refused', reason: refusal, result: result.data })
            : stringifyResult(result.data),
        },
      ];
      if (result.image) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: result.image.caption },
            { type: 'image_url', image_url: { url: result.image.dataUrl } },
          ],
        });
      }
      return {
        messages,
        audit: {
          callId: call.id,
          name: tool.name,
          status: record.status,
          refused: refusal != null,
          refusalReason: refusal ?? undefined,
          mutated,
          qualityBefore,
          qualityAfter: this.qualitySnapshot(boardId),
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
        },
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}
