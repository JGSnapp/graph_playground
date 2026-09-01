export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  /** Data URL for images, used both for display and for vision-capable models. */
  dataUrl?: string;
  /** Extracted text for non-image attachments. */
  text?: string;
  size?: number;
}

export type ToolCallStatus = 'running' | 'done' | 'refused' | 'error';

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result?: unknown;
  refusalReason?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Tokens the provider billed for a whole run, summed over its iterations. */
export interface MessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** Provider calls that produced these numbers, so partial data is visible. */
  calls: number;
  /** Calls where the provider reported nothing; `calls` excludes them. */
  callsWithoutUsage: number;
}

export interface ChatMessage {
  id: string;
  boardId: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCallRecord[];
  model?: string;
  error?: string;
  /** Absent until the run ends, or when the provider reports no usage at all. */
  usage?: MessageUsage;
  createdAt: number;
}
