import type { AgentEvent, Settings } from '@teca/shared';
import type { BoardsService } from '../../boards/boards.service.js';
import type { KnowledgeService } from '../../knowledge/knowledge.service.js';
import type { SkillsService } from '../../skills/skills.service.js';
import type { ScreenshotBroker } from '../screenshots.js';

export interface ToolContext {
  boardId: string;
  boards: BoardsService;
  knowledge: KnowledgeService;
  skills: SkillsService;
  settings: Settings;
  screenshots: ScreenshotBroker;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

export interface ToolResult {
  /** JSON-serializable payload handed back to the model. */
  data: unknown;
  /** Attached as a follow-up vision message when the tool returns pixels. */
  image?: { dataUrl: string; caption: string };
  /** Whether the board changed, so the client can be refreshed. */
  mutated?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Tools can be hidden from the model based on settings. */
  isEnabled?: (settings: Settings) => boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const num = (description: string) => ({ type: 'number', description });
export const int = (description: string) => ({ type: 'integer', description });
export const str = (description: string) => ({ type: 'string', description });
export const bool = (description: string) => ({ type: 'boolean', description });
export const enumOf = (values: readonly string[], description: string) => ({
  type: 'string',
  enum: [...values],
  description,
});
