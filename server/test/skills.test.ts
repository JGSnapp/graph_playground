import type { Settings } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemMessage } from '../src/modules/agent/prompt.js';
import { ToolRegistry } from '../src/modules/agent/tools/index.js';
import { SkillsService } from '../src/modules/skills/skills.service.js';
import { makeEnv } from './helpers.js';

const toolContext = (env: ReturnType<typeof makeEnv>, boardId: string) => ({
  boardId,
  boards: env.ctx.boards,
  knowledge: env.ctx.knowledge,
  skills: env.ctx.skills,
  settings: env.ctx.settings.get(),
  screenshots: env.ctx.screenshots,
  emit: () => undefined,
  signal: new AbortController().signal,
});

describe('skills service', () => {
  it('seeds the two built-in layout skills', () => {
    const env = makeEnv();
    try {
      const slugs = env.ctx.skills.list().map((skill) => skill.slug);
      expect(slugs).toEqual(expect.arrayContaining(['artifact-set', 'graph-layout']));

      const graph = env.ctx.skills.get('graph-layout');
      expect(graph.source).toBe('builtin');
      // By default the skill is the one that leaves the choice to the model:
      // place by hand on a small graph, call the layout on a tangled one, and
      // check afterwards that the layout drew what was meant.
      expect(graph.body).toMatch(/board_arrange_graph/);
      expect(graph.body).toMatch(/board_route_arrows/);
      expect(graph.body).toMatch(/artifact_rank_placements/);
      expect(graph.body).toMatch(/Выбери способ расстановки/);
      expect(graph.body).toMatch(/Проверь, что вышло задуманное/);
      // The layout defaults must never read as a ban: an explicit user request wins.
      expect(graph.body).toMatch(/Просьба пользователя главнее/);
      expect(graph.body).toMatch(/exact=true/);
      expect(graph.body).toMatch(/lockIds/);
    } finally {
      void env.dispose();
    }
  });

  it('adds, edits and removes user skills with unique slugs', () => {
    const env = makeEnv();
    try {
      const first = env.ctx.skills.add({ name: 'Мой скилл', when: 'иногда', body: 'текст' });
      const second = env.ctx.skills.add({ name: 'Мой скилл', when: 'иногда', body: 'текст' });
      expect(first.slug).not.toBe(second.slug);
      expect(first.source).toBe('user');

      const updated = env.ctx.skills.update(first.id, { name: 'Переименован', enabled: false });
      expect(updated.name).toBe('Переименован');
      expect(env.ctx.skills.catalog().some((s) => s.slug === first.slug)).toBe(false);

      env.ctx.skills.remove(second.id);
      expect(() => env.ctx.skills.get(second.slug)).toThrow();
    } finally {
      void env.dispose();
    }
  });

  it('refreshes an untouched built-in skill when the shipped text changes', async () => {
    const env = makeEnv();
    try {
      const graph = env.ctx.skills.get('graph-layout');
      // Pretend the installed copy came from an older release.
      env.ctx.skills.update(graph.id, { body: 'старый текст' });
      const file = path.join(env.dir, 'skills.json');
      await env.ctx.skills.flush();
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.seedBodies['graph-layout'] = 'старый текст';
      fs.writeFileSync(file, JSON.stringify(data));

      const reopened = new SkillsService(env.dir);
      expect(reopened.get('graph-layout').body).toMatch(/board_route_arrows/);
    } finally {
      void env.dispose();
    }
  });

  it('never overwrites a built-in skill the user edited', async () => {
    const env = makeEnv();
    try {
      const graph = env.ctx.skills.get('graph-layout');
      env.ctx.skills.update(graph.id, { body: 'мой собственный порядок действий' });
      await env.ctx.skills.flush();

      const reopened = new SkillsService(env.dir);
      expect(reopened.get('graph-layout').body).toBe('мой собственный порядок действий');
    } finally {
      void env.dispose();
    }
  });

  it('restores built-in skills after they were edited or deleted', () => {
    const env = makeEnv();
    try {
      const graph = env.ctx.skills.get('graph-layout');
      env.ctx.skills.update(graph.id, { body: 'испорчено' });
      env.ctx.skills.remove(env.ctx.skills.get('artifact-set').id);

      env.ctx.skills.restoreBuiltins();
      expect(env.ctx.skills.get('graph-layout').body).toMatch(/board_route_arrows/);
      expect(env.ctx.skills.get('artifact-set')).toBeDefined();
    } finally {
      void env.dispose();
    }
  });
});

describe('skill tools', () => {
  it('returns the catalog and the full body', async () => {
    const env = makeEnv();
    try {
      const board = env.ctx.boards.create();
      const registry = new ToolRegistry();

      const list = await registry.get('skill_list')!.run({}, toolContext(env, board.id));
      const catalog = (list as { data: { skills: Array<{ slug: string; when: string }> } }).data;
      expect(catalog.skills.map((s) => s.slug)).toContain('graph-layout');
      expect(catalog.skills[0].when.length).toBeGreaterThan(0);

      const got = await registry
        .get('skill_get')!
        .run({ slug: 'graph-layout' }, toolContext(env, board.id));
      expect((got as { data: { body: string } }).data.body).toMatch(/Шаг 4/);
    } finally {
      void env.dispose();
    }
  });

  it('is hidden when skills are switched off', () => {
    const settings = (enabled: boolean): Settings => ({
      provider: { baseUrl: '', apiKey: '', defaultModel: '', embeddingModel: '' },
      agent: {
        systemPrompt: '',
        maxIterations: 5,
        unlimitedIterations: false,
        providerRetries: 0,
        temperature: 0,
        maxTokens: 8192,
      },
      knowledge: { readEnabled: true, writeEnabled: true, topK: 5 },
      skills: { enabled },
    });
    const names = (enabled: boolean) =>
      new ToolRegistry().enabled(settings(enabled)).map((tool) => tool.name);

    expect(names(true)).toEqual(expect.arrayContaining(['skill_list', 'skill_get']));
    expect(names(false)).not.toContain('skill_get');
  });
});

describe('system prompt', () => {
  it('carries the skill catalog but not the bodies', () => {
    const env = makeEnv();
    try {
      const board = env.ctx.boards.create();
      const message = systemMessage(board, env.ctx.settings.get(), env.ctx.skills.catalog());
      const content = String(message.content);
      expect(content).toMatch(/graph-layout/);
      expect(content).toMatch(/skill_get/);
      // The full instructions stay out of the prompt until the agent asks.
      const step = 'Шаг 4. Проверь, что вышло задуманное';
      expect(env.ctx.skills.get('graph-layout').body).toContain(step);
      expect(content).not.toContain(step);
    } finally {
      void env.dispose();
    }
  });
});
