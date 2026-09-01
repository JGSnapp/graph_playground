import type { IntersectionCounts, MessageUsage, QualityGrade, ToolCallStatus } from '@teca/shared';
import type { TokenUsage } from '../llm/types.js';
import path from 'node:path';
import { notFound } from '../../core/errors.js';
import { JsonStore } from '../../core/store.js';

const RUN_LOG_LIMIT = 500;

export interface RunQualitySnapshot {
  score: number;
  cost: number;
  grade: QualityGrade;
  counts: IntersectionCounts;
  artifactCount: number;
  arrowCount: number;
}

export interface RunCheckpointLog {
  checkpointId: string;
  iteration: number;
  toolCallId?: string;
  capturedAt: number;
  quality: RunQualitySnapshot;
  restoredAt?: number;
}

export interface RunToolLog {
  callId: string;
  name: string;
  status: ToolCallStatus;
  refused: boolean;
  refusalReason?: string;
  mutated: boolean;
  qualityBefore: RunQualitySnapshot;
  qualityAfter: RunQualitySnapshot;
  startedAt: number;
  finishedAt: number;
}

export interface RunIterationLog {
  iteration: number;
  startedAt: number;
  finishedAt?: number;
  qualityBefore: RunQualitySnapshot;
  qualityAfter?: RunQualitySnapshot;
  refusalStatus: 'none' | 'refused';
  refusalReasons: string[];
  /** Tokens the provider billed for this iteration; absent if it reported none. */
  usage?: TokenUsage;
  toolCalls: RunToolLog[];
}

export type RunTerminationReason =
  | 'completed'
  | 'iteration_limit'
  | 'provider_error'
  | 'aborted'
  | 'empty_response';

export interface AgentRunLog {
  runId: string;
  boardId: string;
  model: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'finished';
  refusalStatus: 'none' | 'encountered';
  refusalReasons: string[];
  terminationReason?: RunTerminationReason;
  terminationMessage?: string;
  iterations: RunIterationLog[];
  /**
   * Token totals for the whole run. `callsWithoutUsage` matters: a provider
   * that reports nothing must not look like a free run.
   */
  usage: MessageUsage;
  bestCheckpoint: RunCheckpointLog;
  restoredBestCheckpoint?: RunCheckpointLog;
}

interface RunLogsData {
  runs: AgentRunLog[];
}

/** Persistent, structured audit trail for every agent run. */
export class RunLogsService {
  private readonly store: JsonStore<RunLogsData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<RunLogsData>(path.join(dataDir, 'runs.json'), () => ({ runs: [] }));
  }

  start(log: AgentRunLog): AgentRunLog {
    this.store.update((data) => {
      data.runs.push(log);
      if (data.runs.length > RUN_LOG_LIMIT) data.runs.splice(0, data.runs.length - RUN_LOG_LIMIT);
    });
    return log;
  }

  get(runId: string): AgentRunLog {
    const log = this.store.get().runs.find((run) => run.runId === runId);
    if (!log) throw notFound(`Run ${runId}`);
    return log;
  }

  list(boardId?: string): AgentRunLog[] {
    return this.store
      .get()
      .runs.filter((run) => boardId == null || run.boardId === boardId)
      .slice()
      .reverse();
  }

  update(runId: string, mutator: (log: AgentRunLog) => void): AgentRunLog {
    return this.store.update(() => {
      const log = this.get(runId);
      mutator(log);
      return log;
    });
  }

  removeForBoard(boardId: string): void {
    this.store.update((data) => {
      data.runs = data.runs.filter((run) => run.boardId !== boardId);
    });
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
