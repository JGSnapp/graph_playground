/**
 * Bench runner: drives one task on one model against a live teca server,
 * then dumps the board, its quality report, observations and a PNG.
 *
 *   tsx bench/run.ts --exp=E01 --task=wiki-anime --model=claude-sonnet-5
 *   tsx bench/run.ts --exp=E01 --task=all --model=gpt-5.6-terra,deepseek-v4-flash
 */
import {
  boardQuality,
  checkIntersections,
  type Board,
  type BoardState,
  type MessageUsage,
} from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExperimentBudget, concurrencyFor, tierOf } from './cost.js';
import { drawnLength, observe } from './metrics.js';
import { boardPng } from './render.js';
import { TASKS, taskById, type BenchTask } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, 'out');

const argOf = (name: string, fallback = ''): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SERVER = argOf('server', 'http://localhost:5199');
const TIMEOUT_MS = Number(argOf('timeout', '1800000'));
/** Ceiling is enforced by `concurrencyFor`; this is only what was asked for. */
const CONCURRENCY = Number(argOf('concurrency', '1'));
const MAX_TOKENS = Number(argOf('maxTokens', '4096'));
/**
 * Repeats per task. One run per task is not a measurement: the same graph came
 * back with one crossing and with eight on two consecutive runs, purely because
 * the model chose a slightly different node size. Twice I read that noise as
 * the effect of a change.
 */
const REPEATS = Math.max(1, Number(argOf('repeat', '1')));

/** Token totals reported by the provider, collected across the experiment. */
const spent: MessageUsage[] = [];

const api = async (method: string, url: string, body?: unknown): Promise<any> => {
  const response = await fetch(`${SERVER}/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
};

interface ToolTrace {
  name: string;
  status: string;
  refused: boolean;
  ms: number;
  args: string;
  resultSummary: string;
}

const summarize = (result: unknown): string => {
  if (result == null) return '';
  const json = typeof result === 'string' ? result : JSON.stringify(result);
  return json.length > 400 ? `${json.slice(0, 400)}…` : json;
};

/**
 * The bench plays the role of the browser: `board_screenshot` asks a connected
 * client for pixels, so without this the agent would only ever see the ASCII
 * fallback and the bench would not match the real product.
 */
const serveScreenshot = async (requestId: string, boardId: string): Promise<void> => {
  try {
    const { board }: { board: Board } = await api('GET', `/boards/${boardId}`);
    const png = boardPng(board.state, 1400);
    await api('POST', `/screenshots/${requestId}`, {
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });
  } catch {
    await api('POST', `/screenshots/${requestId}`, { dataUrl: null }).catch(() => undefined);
  }
};

const runAgent = async (
  boardId: string,
  model: string,
  prompt: string,
): Promise<{
  tools: ToolTrace[];
  answer: string;
  errors: string[];
  runId: string | null;
  ms: number;
  aborted: boolean;
  screenshots: number;
}> => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const response = await fetch(`${SERVER}/api/boards/${boardId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, model }),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) throw new Error(`chat -> ${response.status}`);

  const tools: ToolTrace[] = [];
  const pending = new Map<string, number>();
  const errors: string[] = [];
  let answer = '';
  let runId: string | null = null;
  let screenshots = 0;
  let aborted = false;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((row) => row.startsWith('data: '));
        if (!line) continue;
        let event: any;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.type === 'run_start') runId = event.runId;
        if (event.type === 'content_delta') answer += event.delta;
        if (event.type === 'content_replace') answer = event.content;
        if (event.type === 'error') errors.push(event.message);
        if (event.type === 'screenshot_request') {
          screenshots += 1;
          void serveScreenshot(event.requestId, event.boardId);
        }
        if (event.type === 'tool_call') pending.set(event.toolCall.id, Date.now());
        if (event.type === 'tool_result') {
          const call = event.toolCall;
          const startedAt = pending.get(call.id) ?? Date.now();
          const result = call.result as any;
          tools.push({
            name: call.name,
            status: call.status,
            refused: Boolean(result && typeof result === 'object' && result.refused === true),
            ms: Date.now() - startedAt,
            // Full arguments: the offline experiments replay the exact
            // parameters the model chose, and a truncated JSON cannot be parsed.
            args: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
            resultSummary: summarize(result),
          });
        }
      }
    }
  } catch (error) {
    aborted = true;
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  return { tools, answer, errors, runId, ms: Date.now() - started, aborted, screenshots };
};

const seedBoard = async (boardId: string, task: BenchTask): Promise<void> => {
  if (!task.seed) return;
  const ids = new Map<string, string>();
  for (const artifact of task.seed.artifacts) {
    const created = await api('POST', `/boards/${boardId}/artifacts`, {
      type: artifact.type,
      x: artifact.x,
      y: artifact.y,
      width: artifact.width,
      height: artifact.height,
      props: artifact.props ?? {},
    });
    ids.set(artifact.ref, created.id);
  }
  for (const arrow of task.seed.arrows ?? []) {
    await api('POST', `/boards/${boardId}/arrows`, {
      fromId: ids.get(arrow.fromRef),
      toId: ids.get(arrow.toRef),
      fromSide: arrow.fromSide,
      toSide: arrow.toSide,
      label: arrow.label,
      style: {},
    });
  }
};

const runOne = async (exp: string, task: BenchTask, model: string, repeat = 0): Promise<void> => {
  const dir = path.join(OUT, exp);
  fs.mkdirSync(dir, { recursive: true });
  const stem = repeat === 0 ? `${task.id}__${model}` : `${task.id}__${model}__r${repeat}`;

  const board: Board = await api('POST', '/boards', { title: `${exp}/${task.id}/${model}`, model });
  await seedBoard(board.id, task);
  const seeded: { board: Board } = await api('GET', `/boards/${board.id}`);
  const before = seeded.board.state;

  let agent: Awaited<ReturnType<typeof runAgent>>;
  try {
    agent = await runAgent(board.id, model, task.prompt);
  } catch (error) {
    agent = {
      tools: [],
      answer: '',
      errors: [error instanceof Error ? error.message : String(error)],
      runId: null,
      ms: 0,
      aborted: true,
      screenshots: 0,
    };
  }

  const after: { board: Board } = await api('GET', `/boards/${board.id}`);
  const state: BoardState = after.board.state;
  const quality = boardQuality(state.artifacts, state.arrows);
  const report = checkIntersections(state.artifacts, state.arrows);

  // Did the agent actually build the graph it was asked for?
  //
  // `boardQuality` only judges geometry, and geometry has nothing to complain
  // about when there are no lines: a board of eleven boxes and no arrows scored
  // a clean 100 on an org-chart task, beating the same task's 82 from the run
  // before, which had the arrows. An empty graph is the perfect graph as far as
  // the metric is concerned. So completeness is checked here, separately, and a
  // task that asked for a graph and got none does not count as a result at all.
  const connected = new Set<string>();
  for (const arrow of state.arrows) {
    connected.add(arrow.from.artifactId);
    connected.add(arrow.to.artifactId);
  }
  const isolated = state.artifacts.filter((artifact) => !connected.has(artifact.id));
  const missingGraph = task.graph && state.arrows.length === 0;
  const brokenGraph =
    task.graph && !missingGraph && isolated.length > state.artifacts.length / 2;
  const runLog = agent.runId
    ? await api('GET', `/runs/${agent.runId}`).catch(() => null)
    : null;

  const result = {
    exp,
    task: task.id,
    repeat,
    probes: task.probes,
    model,
    at: new Date().toISOString(),
    ms: agent.ms,
    aborted: agent.aborted,
    screenshotsServed: agent.screenshots,
    iterations: runLog?.run?.iterations?.length ?? null,
    seededArtifacts: before.artifacts.length,
    seededArrows: before.arrows.length,
    quality: {
      score: quality.score,
      cost: quality.cost,
      grade: quality.grade,
      counts: quality.counts,
      metrics: quality.metrics,
      breakdown: quality.breakdown,
    },
    // Reported next to the score, never folded into it: a score says how well
    // the picture is drawn, this says whether it is the right picture.
    completeness: {
      isolatedNodes: isolated.length,
      isolatedIds: isolated.map((artifact) => artifact.id),
      missingGraph,
      brokenGraph,
      counts: !missingGraph && !brokenGraph,
    },
    observations: observe(state),
    drawnLength: drawnLength(state),
    ok: report.ok,
    findings: report.findings.slice(0, 60),
    toolCalls: agent.tools,
    toolHistogram: agent.tools.reduce<Record<string, number>>((acc, t) => {
      acc[t.name] = (acc[t.name] ?? 0) + 1;
      return acc;
    }, {}),
    refusals: agent.tools.filter((t) => t.refused).map((t) => ({ name: t.name, why: t.resultSummary })),
    errors: agent.errors,
    usage: runLog?.run?.usage ?? null,
    termination: runLog?.run?.terminationReason ?? null,
    restoredCheckpoint: Boolean(runLog?.run?.restoredBestCheckpoint),
    answer: agent.answer,
    boardId: board.id,
    state,
  };

  if (result.usage) spent.push(result.usage);
  fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(result, null, 2));
  try {
    fs.writeFileSync(path.join(dir, `${stem}.png`), boardPng(state));
  } catch (error) {
    console.warn(`\n  png failed: ${error instanceof Error ? error.message : error}`);
  }

  console.log(
    `${(repeat === 0 ? task.id : `${task.id}#${repeat + 1}`).padEnd(18)} ${model.padEnd(18)} score ${String(quality.score).padStart(3)}/100 ` +
      `(${quality.grade}) cost ${quality.cost} | ${state.artifacts.length} узлов, ${state.arrows.length} связей | ` +
      `${missingGraph ? 'НЕ ЗАСЧИТАНО: связей нет вовсе | ' : ''}` +
      `${brokenGraph ? `НЕ ЗАСЧИТАНО: ${isolated.length} узлов ни с чем не связаны | ` : ''}` +
      `${!missingGraph && !brokenGraph && isolated.length > 0 ? `${isolated.length} узлов без связей | ` : ''}` +
      `${result.iterations ?? '?'} итер, ${result.refusals.length} отказов | ${Math.round(agent.ms / 1000)}s` +
      `${result.usage ? ` | ${result.usage.promptTokens}+${result.usage.completionTokens} ток` : ''}` +
      `${agent.errors.length ? ` | ОШИБКИ: ${agent.errors.join('; ').slice(0, 120)}` : ''}`,
  );
};

const main = async () => {
  const exp = argOf('exp', 'E00');
  const taskArg = argOf('task', 'all');
  const models = argOf('model', 'deepseek-v4-flash').split(',').map((m) => m.trim()).filter(Boolean);
  const tasks = taskArg === 'all' ? TASKS : taskArg.split(',').map((id) => taskById(id.trim()));

  // Cost gate. An expensive model needs an explicit flag, because the gateway
  // reserves against the whole balance and one careless parallel run empties it.
  const allowExpensive = process.argv.includes('--allow-expensive');
  const expensive = models.filter((model) => tierOf(model) === 'expensive');

  if (expensive.length > 0 && !allowExpensive) {
    console.error(
      `Дорогие модели в наборе: ${expensive.join(', ')}.\n` +
        `Стенд по умолчанию гоняет только дешёвые (deepseek*, claude-haiku). Дорогие включаются\n` +
        `явно: добавь --allow-expensive и запускай их, когда дешёвая модель уже даёт вменяемый\n` +
        `результат, — иначе прогон дорогой модели просто подтвердит то, что и так видно.`,
    );
    process.exit(2);
  }

  // Budgets are per board and per experiment: a single request is never the
  // interesting number, a board takes a dozen of them.
  const verdict = checkExperimentBudget({
    models,
    runs: models.length * tasks.length * REPEATS,
    maxTokens: MAX_TOKENS,
    budgetRun: Number(argOf('budget-run', '25')),
    budgetExperiment: Number(argOf('budget-exp', '400')),
  });
  console.log('  Оценка резерва шлюза (не факт списания):');
  for (const line of verdict.lines) console.log(line);
  if (!verdict.problem) {
    console.log('');
  } else {
    console.error(`\nПрогон остановлен.\n${verdict.problem}`);
    process.exit(2);
  }

  const { value: concurrency, note } = concurrencyFor(models, CONCURRENCY);
  if (note) console.log(`  ${note}`);
  console.log(
    `  ${models.length} модель(ей) × ${tasks.length} задач(и) × ${REPEATS} повтор(а) = ${models.length * tasks.length * REPEATS} прогонов, ` +
      `параллельно ${concurrency}, maxTokens ${MAX_TOKENS}\n`,
  );

  // `max_tokens` drives the reservation and lives in settings, not in the chat
  // request, so the bench pins it on the server before the first run.
  await api('PATCH', '/settings', { agent: { maxTokens: MAX_TOKENS } });

  const jobs: Array<{ task: BenchTask; model: string; repeat: number }> = [];
  for (const model of models) {
    for (const task of tasks) {
      for (let repeat = 0; repeat < REPEATS; repeat++) jobs.push({ task, model, repeat });
    }
  }

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const { task, model, repeat } = jobs[index];
      try {
        await runOne(exp, task, model, repeat);
      } catch (error) {
        console.error(`✖ ${task.id} @ ${model}: ${error instanceof Error ? error.message : error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const totals = spent.reduce(
    (acc, row) => ({
      prompt: acc.prompt + row.promptTokens,
      completion: acc.completion + row.completionTokens,
      calls: acc.calls + row.calls,
      unreported: acc.unreported + row.callsWithoutUsage,
    }),
    { prompt: 0, completion: 0, calls: 0, unreported: 0 },
  );
  console.log(
    `\nТокены за эксперимент: ${totals.prompt} вход + ${totals.completion} выход ` +
      `за ${totals.calls} запрос(ов)` +
      (totals.unreported > 0 ? `; ${totals.unreported} запрос(ов) провайдер не отчитал` : ''),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
