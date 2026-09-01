/**
 * Side-by-side of two experiments on the same pool.
 *
 *   tsx bench/compare.ts E02 E03
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Row {
  task: string;
  score: number;
  ok: boolean;
  iterations: number;
  refusals: number;
  crossings: number;
  aspect: number;
  promptTokens: number;
  completionTokens: number;
  seconds: number;
}

const load = (exp: string): Map<string, Row> => {
  const dir = path.join(here, 'out', exp);
  const out = new Map<string, Row>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    out.set(r.task, {
      task: r.task,
      score: r.quality.score,
      ok: r.ok,
      iterations: r.iterations ?? 0,
      refusals: (r.refusals ?? []).length,
      crossings: r.quality.counts.arrowArrow,
      aspect: r.observations.aspect,
      promptTokens: r.usage?.promptTokens ?? 0,
      completionTokens: r.usage?.completionTokens ?? 0,
      seconds: Math.round(r.ms / 1000),
    });
  }
  return out;
};

const [a, b] = [process.argv[2] ?? 'E02', process.argv[3] ?? 'E03'];
const left = load(a);
const right = load(b);
const tasks = [...new Set([...left.keys(), ...right.keys()])].sort();

const arrow = (from: number, to: number, higherIsBetter = true): string => {
  if (from === to) return '=';
  const better = higherIsBetter ? to > from : to < from;
  return better ? '↑' : '↓';
};

console.log(`\n| задача | score ${a}→${b} | | итераций | | пересечений | токенов вход |`);
console.log('|---|---|---|---|---|---|---|');
for (const task of tasks) {
  const l = left.get(task);
  const r = right.get(task);
  if (!l || !r) {
    console.log(`| ${task} | ${l ? l.score : '—'} → ${r ? r.score : '—'} | | | | | |`);
    continue;
  }
  console.log(
    `| ${task} | ${l.score} → **${r.score}** | ${arrow(l.score, r.score)} | ` +
      `${l.iterations} → ${r.iterations} | ${arrow(l.iterations, r.iterations, false)} | ` +
      `${l.crossings} → ${r.crossings} | ${(l.promptTokens / 1000).toFixed(0)}k → ${(r.promptTokens / 1000).toFixed(0)}k |`,
  );
}

const stats = (rows: Row[]) => ({
  score: Math.round(rows.reduce((s, x) => s + x.score, 0) / rows.length),
  ok: rows.filter((x) => x.ok).length,
  iterations: Math.round(rows.reduce((s, x) => s + x.iterations, 0) / rows.length),
  refusals: rows.reduce((s, x) => s + x.refusals, 0),
  crossings: rows.reduce((s, x) => s + x.crossings, 0),
  prompt: rows.reduce((s, x) => s + x.promptTokens, 0),
  seconds: rows.reduce((s, x) => s + x.seconds, 0),
});

const sl = stats([...left.values()]);
const sr = stats([...right.values()]);
console.log(`\n| показатель | ${a} | ${b} |`);
console.log('|---|---|---|');
console.log(`| средний score | ${sl.score} | **${sr.score}** |`);
console.log(`| ok | ${sl.ok}/${left.size} | **${sr.ok}/${right.size}** |`);
console.log(`| средн. итераций | ${sl.iterations} | ${sr.iterations} |`);
console.log(`| отказов всего | ${sl.refusals} | ${sr.refusals} |`);
console.log(`| пересечений всего | ${sl.crossings} | ${sr.crossings} |`);
console.log(`| входных токенов | ${(sl.prompt / 1e6).toFixed(2)}M | ${(sr.prompt / 1e6).toFixed(2)}M |`);
console.log(`| время, мин | ${Math.round(sl.seconds / 60)} | ${Math.round(sr.seconds / 60)} |`);
