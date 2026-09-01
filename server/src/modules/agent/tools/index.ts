import type { Settings } from '@teca/shared';
import type { ToolDefinition } from '../../llm/types.js';
import { arrangeTools } from './arrange.tools.js';
import { arrowTools } from './arrow.tools.js';
import { artifactTools } from './artifact.tools.js';
import { knowledgeTools } from './knowledge.tools.js';
import { layoutTools } from './layout.tools.js';
import { perceptionTools } from './perception.tools.js';
import { skillTools } from './skills.tools.js';
import type { ToolSpec } from './types.js';

/** Every tool the agent can call. Add a module here to extend the agent. */
export const ALL_TOOLS: ToolSpec[] = [
  ...skillTools,
  ...perceptionTools,
  ...artifactTools,
  ...arrowTools,
  ...layoutTools,
  ...arrangeTools,
  ...knowledgeTools,
];

export class ToolRegistry {
  private readonly byName: Map<string, ToolSpec>;

  constructor(private readonly tools: ToolSpec[] = ALL_TOOLS) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  get(name: string): ToolSpec | undefined {
    return this.byName.get(name);
  }

  enabled(settings: Settings): ToolSpec[] {
    return this.tools.filter((tool) => tool.isEnabled?.(settings) ?? true);
  }

  definitions(settings: Settings): ToolDefinition[] {
    return this.enabled(settings).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

export type { ToolContext, ToolResult, ToolSpec } from './types.js';
