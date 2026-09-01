import type { Board } from './boards.js';
import type { ChatMessage, ToolCallRecord } from './chat.js';

/** Server-sent events emitted while an agent run is in progress. */
export type AgentEvent =
  | { type: 'run_start'; runId: string; boardId: string; model: string }
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: string }
  | { type: 'reasoning_delta'; messageId: string; delta: string }
  | { type: 'content_replace'; messageId: string; content: string }
  | { type: 'reasoning_replace'; messageId: string; reasoning: string }
  | { type: 'status'; message: string }
  | { type: 'tool_call'; messageId: string; toolCall: ToolCallRecord }
  | { type: 'tool_result'; messageId: string; toolCall: ToolCallRecord }
  | { type: 'message_end'; message: ChatMessage }
  | { type: 'board_updated'; board: Board }
  | { type: 'screenshot_request'; requestId: string; boardId: string; region: { x: number; y: number; width: number; height: number } }
  | { type: 'error'; message: string }
  | { type: 'run_end'; runId: string };
