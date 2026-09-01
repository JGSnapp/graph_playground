import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/modules/agent/tools/index.js';
import { makeEnv } from './helpers.js';
import { createArrow, createArtifact } from '../src/modules/boards/operations.js';

describe('board_check_intersections tool', () => {
  it('is registered for the agent', () => {
    const names = new ToolRegistry().enabled({
      provider: { baseUrl: '', apiKey: '', defaultModel: '', embeddingModel: '' },
      agent: {
        systemPrompt: '',
        maxIterations: 5,
        unlimitedIterations: false,
        providerRetries: 0,
        temperature: 0,
        maxTokens: 8192,
      },
      knowledge: { readEnabled: false, writeEnabled: false, topK: 5 },
      skills: { enabled: true },
    }).map((t) => t.name);
    expect(names).toContain('board_check_intersections');
  });

  it('reports arrow cutting through a middle artifact with sides', () => {
    const env = makeEnv();
    try {
      const board = env.ctx.boards.create();
      env.ctx.boards.mutate(board.id, (state) => {
        const a = createArtifact(state, { type: 'note', x: 0, y: 0 });
        createArtifact(state, { type: 'note', x: 250, y: 0 });
        const b = createArtifact(state, { type: 'note', x: 500, y: 0 });
        createArrow(state, { fromId: a.id, toId: b.id, fromSide: 'right', toSide: 'left' });
      });

      const tool = new ToolRegistry().get('board_check_intersections');
      expect(tool).toBeDefined();
      const result = tool!.run(
        {},
        {
          boardId: board.id,
          boards: env.ctx.boards,
          knowledge: env.ctx.knowledge,
          skills: env.ctx.skills,
          settings: env.ctx.settings.get(),
          screenshots: env.ctx.screenshots,
          emit: () => undefined,
          signal: new AbortController().signal,
        },
      );
      const data = (result as { data: { ok: boolean; findings: Array<{ kind: string; entrySide?: string; exitSide?: string }> } }).data;
      expect(data.ok).toBe(false);
      const crossing = data.findings.find((f) => f.kind === 'arrow_artifact');
      expect(crossing).toMatchObject({ entrySide: 'left', exitSide: 'right' });
    } finally {
      void env.dispose();
    }
  });
});
