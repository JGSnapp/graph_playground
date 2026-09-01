import type { AgentEvent } from '@teca/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { contentFrame, finishFrame, makeEnv, sseResponse, toolCallFrame, type TestEnv } from './helpers.js';

describe('http api', () => {
  let env: TestEnv;
  let app: Express;

  beforeEach(() => {
    env = makeEnv();
    app = createApp(env.ctx);
  });

  afterEach(async () => {
    await env.dispose();
  });

  it('reports health and provider configuration', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true, providerConfigured: false });
  });

  it('never leaks the api key through the settings endpoint', async () => {
    await request(app).patch('/api/settings').send({ provider: { apiKey: 'secret-key' } }).expect(200);
    const res = await request(app).get('/api/settings').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret-key');
    expect(res.body.provider.apiKeySet).toBe(true);
  });

  it('validates settings payloads', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .send({ agent: { maxIterations: 999 } })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('exposes skills for the editor and keeps built-ins restorable', async () => {
    const list = await request(app).get('/api/skills').expect(200);
    const graph = list.body.skills.find((s: { slug: string }) => s.slug === 'graph-layout');
    expect(graph.source).toBe('builtin');

    const created = await request(app)
      .post('/api/skills')
      .send({ name: 'Мой скилл', when: 'иногда', body: 'шаги' })
      .expect(201);
    expect(created.body.slug).toBe('мой-скилл');

    await request(app)
      .patch(`/api/skills/${created.body.id}`)
      .send({ body: 'другие шаги', enabled: false })
      .expect(200);
    await request(app).delete(`/api/skills/${created.body.id}`).expect(204);

    await request(app).patch(`/api/skills/${graph.id}`).send({ body: 'сломано' }).expect(200);
    const restored = await request(app).post('/api/skills/restore').expect(200);
    const back = restored.body.skills.find((s: { slug: string }) => s.slug === 'graph-layout');
    expect(back.body).toMatch(/board_route_arrows/);
  });

  it('rejects an empty skill name', async () => {
    await request(app).post('/api/skills').send({ name: '', when: 'x', body: 'y' }).expect(400);
  });

  it('serves a fallback model list without an api key', async () => {
    const res = await request(app).get('/api/models').expect(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.models.length).toBeGreaterThan(0);
  });

  it('walks the full board lifecycle', async () => {
    const created = await request(app).post('/api/boards').send({ title: 'Тест' }).expect(201);
    const boardId = created.body.id as string;

    const artifact = await request(app)
      .post(`/api/boards/${boardId}/artifacts`)
      .send({ type: 'note', x: 0, y: 0, props: { text: 'раз' } })
      .expect(201);
    const second = await request(app)
      .post(`/api/boards/${boardId}/artifacts`)
      .send({ type: 'note', x: 400, y: 0 })
      .expect(201);

    const arrow = await request(app)
      .post(`/api/boards/${boardId}/arrows`)
      .send({ fromId: artifact.body.id, toId: second.body.id, fromSide: 'right', toSide: 'left' })
      .expect(201);

    await request(app)
      .post(`/api/boards/${boardId}/arrows/${arrow.body.id}/bends`)
      .send({ x: 200, y: 100 })
      .expect(200);

    await request(app)
      .patch(`/api/boards/${boardId}/artifacts/${artifact.body.id}`)
      .send({ x: 40, props: { text: 'два' } })
      .expect(200);

    const loaded = await request(app).get(`/api/boards/${boardId}`).expect(200);
    expect(loaded.body.board.state.artifacts[0]).toMatchObject({ x: 40, props: { text: 'два' } });
    expect(loaded.body.board.state.arrows[0].bends).toEqual([{ x: 200, y: 100 }]);
    expect(loaded.body.history.canUndo).toBe(true);

    const undone = await request(app).post(`/api/boards/${boardId}/undo`).expect(200);
    expect(undone.body.board.state.artifacts[0].props.text).toBe('раз');
    expect(undone.body.history.canRedo).toBe(true);

    await request(app).delete(`/api/boards/${boardId}`).expect(204);
    await request(app).get(`/api/boards/${boardId}`).expect(404);
  });

  it('rejects unknown artifact types', async () => {
    const created = await request(app).post('/api/boards').send({}).expect(201);
    await request(app)
      .post(`/api/boards/${created.body.id}/artifacts`)
      .send({ type: 'hologram', x: 0, y: 0 })
      .expect(400);
  });

  it('searches the knowledge base and accepts new entries', async () => {
    const listed = await request(app).get('/api/knowledge').expect(200);
    expect(listed.body.entries.length).toBeGreaterThan(10);

    const search = await request(app)
      .post('/api/knowledge/search')
      .send({ query: 'киберпанк неон мегакорпорации', k: 3 })
      .expect(200);
    expect(search.body.hits[0].title).toContain('Киберпанк');

    const added = await request(app)
      .post('/api/knowledge')
      .send({ title: 'Ковбой Бибоп OST', text: 'Seatbelts и Ёко Канно', tags: ['музыка'] })
      .expect(201);
    expect(added.body.source).toBe('user');

    await request(app).delete(`/api/knowledge/${added.body.id}`).expect(204);
  });

  it('ignores screenshot payloads for unknown requests', async () => {
    const res = await request(app)
      .post('/api/screenshots/shot_unknown')
      .send({ dataUrl: null })
      .expect(200);
    expect(res.body.accepted).toBe(false);
  });

  it('returns 404 for a chat on a missing board', async () => {
    await request(app).post('/api/boards/brd_missing/chat').send({ text: 'привет' }).expect(404);
  });
});

describe('chat streaming endpoint', () => {
  let env: TestEnv;
  let app: Express;

  beforeEach(() => {
    const responses = [
      sseResponse([
        toolCallFrame(
          0,
          'call_1',
          'artifact_create',
          JSON.stringify({ type: 'note', x: 20, y: 20, props: { text: 'из чата' } }),
        ),
        finishFrame('tool_calls'),
      ]),
      sseResponse([contentFrame('Готово.'), finishFrame('stop')]),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    env = makeEnv({ fetchImpl });
    env.ctx.settings.update({ provider: { apiKey: 'test-key' } });
    app = createApp(env.ctx);
  });

  afterEach(async () => {
    await env.dispose();
  });

  it('streams agent events over server-sent events and persists the exchange', async () => {
    const board = env.ctx.boards.create();

    const res = await request(app)
      .post(`/api/boards/${board.id}/chat`)
      .send({ text: 'Добавь заметку' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    const events = res.text
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data:'))
      .map((chunk) => JSON.parse(chunk.slice(5)) as AgentEvent);

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['run_start', 'tool_call', 'tool_result', 'board_updated', 'run_end']),
    );
    expect(env.ctx.boards.get(board.id).state.artifacts[0].props.text).toBe('из чата');

    const stored = await request(app).get(`/api/boards/${board.id}/messages`).expect(200);
    expect(stored.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(stored.body.messages[1].content).toBe('Готово.');
  });
});
