/**
 * Side-by-side of two experiments on the same pool.
 *
 *   tsx bench/compare.ts E05 E07
 *
 * Repeats of one task are folded into a median and a spread. One run per task
 * is not a measurement: the same graph came back with one crossing and with
 * eight on consecutive runs, purely because the model picked a different node
 * size. A difference smaller than the spread is not a result.
 */
import { boardQuality, checkIntersections } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskById } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Sample {
  score: number;
  ok: boolean;
  /** The graph the task asked for was actually built. */
  counts: boolean;
  iterations: number;
  refusals: number;
  crossings: number;
  promptTokens: number;
  seconds: number;
}

export interface Aggregate {
  /** Runs thrown out because the graph the task asked for was not built. */
  notCounted: number;
  task: string;
  probes: string;
  runs: number;
  score: number;
  spread: number;
  okShare: number;
  iterations: number;
  refusals: number;
  crossings: number;
  promptTokens: number;
  seconds: number;
  /** Best run of the task, for the screenshot page. */
  bestPng: string;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const load = (exp: string): Map<string, Aggregate> => {
  const dir = path.join(here, 'out', exp);
  if (!fs.existsSync(dir)) return new Map();
  const samples = new Map<string, Array<Sample & { png: string; probes: string }>>();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    // Re-measured with today's engine, not the score frozen at run time.
    const quality = boardQuality(r.state.artifacts, r.state.arrows);
    const report = checkIntersections(r.state.artifacts, r.state.arrows);
    // Runs recorded before the completeness check existed have no verdict of
    // their own; recompute it, so old experiments compare on the same footing.
    const connected = new Set<string>();
    for (const arrow of r.state.arrows) {
      connected.add(arrow.from.artifactId);
      connected.add(arrow.to.artifactId);
    }
    const isolated = r.state.artifacts.filter((a: { id: string }) => !connected.has(a.id));
    const wantsGraph = taskById(r.task).graph;
    const counts =
      !wantsGraph ||
      (r.state.arrows.length > 0 && isolated.length <= r.state.artifacts.length / 2);
    const list = samples.get(r.task) ?? [];
    list.push({
      score: quality.score,
      ok: report.ok,
      counts,
      iterations: r.iterations ?? 0,
      refusals: (r.refusals ?? []).length,
      crossings: quality.counts.arrowArrow,
      promptTokens: r.usage?.promptTokens ?? 0,
      seconds: Math.round(r.ms / 1000),
      png: `${exp}/${file.replace('.json', '.png')}`,
      probes: r.probes ?? '',
    });
    samples.set(r.task, list);
  }

  const out = new Map<string, Aggregate>();
  for (const [task, list] of samples) {
    // A board that never got its arrows is not a good board with a high score;
    // it is not a result. Averaging it in rewards the agent for doing less.
    const valid = list.filter((s) => s.counts);
    const scores = (valid.length > 0 ? valid : list).map((s) => s.score);
    const best = [...list].sort((a, b) => b.score - a.score)[0];
    out.set(task, {
      task,
      probes: best.probes,
      runs: list.length,
      notCounted: list.length - valid.length,
      score: median(scores),
      spread: Math.max(...scores) - Math.min(...scores),
      okShare: list.filter((s) => s.ok).length / list.length,
      iterations: median(list.map((s) => s.iterations)),
      refusals: list.reduce((a, s) => a + s.refusals, 0),
      crossings: median(list.map((s) => s.crossings)),
      promptTokens: list.reduce((a, s) => a + s.promptTokens, 0),
      seconds: list.reduce((a, s) => a + s.seconds, 0),
      bestPng: best.png,
    });
  }
  return out;
};

const main = () => {
  const [a, b] = [process.argv[2] ?? 'E05', process.argv[3] ?? 'E06'];
  const left = load(a);
  const right = load(b);
  const tasks = [...new Set([...left.keys(), ...right.keys()])].sort();

  console.log(`\n| задача | ${a} | ${b} | вывод | итераций |`);
  console.log('|---|---|---|---|---|');
  for (const task of tasks) {
    const l = left.get(task);
    const r = right.get(task);
    // Averaging the two spreads, not taking the larger: a noisy run followed by
    // a tight one is exactly the shape of a real improvement, and the maximum
    // rule hid a jump from 60±48 to a flat 100.
    const noise = ((l?.spread ?? 0) + (r?.spread ?? 0)) / 2;
    const verdict =
      l && r
        ? Math.abs(r.score - l.score) <= noise
          ? 'в пределах разброса'
          : `${r.score - l.score > 0 ? '+' : ''}${r.score - l.score}` +
            (r.spread < l.spread ? `, разброс ${l.spread} → ${r.spread}` : '')
        : 'нет пары';
    const show = (x?: Aggregate) =>
      x
        ? `${x.score}${x.runs > 1 ? `±${x.spread}` : ''}${x.notCounted ? ` (не засчитано ${x.notCounted})` : ''}`
        : '—';
    console.log(
      `| ${task} | ${show(l)} | ${show(r)} | ${verdict} | ${l?.iterations ?? '—'} → ${r?.iterations ?? '—'} |`,
    );
  }

  const stats = (all: Aggregate[]) => {
    // A task whose every run failed to build the graph contributes no score.
    // Leaving it in rewards the agent for drawing nothing: an org chart with no
    // arrows scores a clean 100, because geometry has nothing to complain about.
    const rows = all.filter((x) => x.notCounted < x.runs);
    return {
    dropped: all.length - rows.length,
    score: rows.length ? Math.round(rows.reduce((s, x) => s + x.score, 0) / rows.length) : 0,
    ok: rows.length ? Math.round((rows.reduce((s, x) => s + x.okShare, 0) / rows.length) * 100) : 0,
    spread: rows.length ? Math.round(rows.reduce((s, x) => s + x.spread, 0) / rows.length) : 0,
    // Tokens and time are spent whether or not the board came out usable.
    prompt: all.reduce((s, x) => s + x.promptTokens, 0),
    minutes: Math.round(all.reduce((s, x) => s + x.seconds, 0) / 60),
    };
  };
  const sl = stats([...left.values()]);
  const sr = stats([...right.values()]);

  console.log(`\n| показатель | ${a} | ${b} |`);
  console.log('|---|---|---|');
  console.log(`| средний score | ${sl.score} | ${sr.score} |`);
  if (sl.dropped || sr.dropped) {
    console.log(`| задач не засчитано | ${sl.dropped} | ${sr.dropped} |`);
  }
  console.log(`| доля без жёстких конфликтов | ${sl.ok}% | ${sr.ok}% |`);
  console.log(`| средний разброс между повторами | ${sl.spread} | ${sr.spread} |`);
  console.log(`| входных токенов | ${(sl.prompt / 1e6).toFixed(2)}M | ${(sr.prompt / 1e6).toFixed(2)}M |`);
  console.log(`| время, мин | ${sl.minutes} | ${sr.minutes} |`);
};

if (process.argv[1]?.endsWith('compare.ts')) main();
