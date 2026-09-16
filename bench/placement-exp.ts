/**
 * Who should place the nodes: the model or the layout?
 *
 * Both arms run the same tasks on the same model with the same limits and the
 * same tools, minus one — the manual arm has no `board_arrange_graph` and a
 * prompt and skill that tell it to work out the coordinates itself. Split by
 * whether the board started empty or already had something on it.
 */
import { boardQuality } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskById } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Row { score: number; it: number; tok: number; sec: number; counts: boolean; hitLimit: boolean }

const load = (exp: string): Map<string, Row> => {
  const out = new Map<string, Row>();
  const dir = path.join(here, 'out', exp);
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const q = boardQuality(d.state.artifacts, d.state.arrows);
    const connected = new Set<string>();
    for (const a of d.state.arrows) { connected.add(a.from.artifactId); connected.add(a.to.artifactId); }
    const isolated = d.state.artifacts.filter((a: { id: string }) => !connected.has(a.id));
    out.set(d.task, {
      score: q.score,
      it: d.iterations ?? 0,
      tok: d.usage?.promptTokens ?? 0,
      sec: Math.round(d.ms / 1000),
      counts: !taskById(d.task).graph || (d.state.arrows.length > 0 && isolated.length <= d.state.artifacts.length / 2),
      hitLimit: d.termination === 'iteration_limit',
    });
  }
  return out;
};

const auto = load('AUTO');
const manual = load('MANUAL');
const seeded = (task: string) => Boolean(taskById(task).seed);

const groups: Array<[string, string[]]> = [
  ['Пустой лист', [...auto.keys()].filter((t) => !seeded(t)).sort()],
  ['Заполненное пространство', [...auto.keys()].filter(seeded).sort()],
];

for (const [title, tasks] of groups) {
  console.log(`\n### ${title}`);
  console.log('| задача | авто: балл / итер / токены | вручную: балл / итер / токены |');
  console.log('|---|---|---|');
  for (const task of tasks) {
    const a = auto.get(task);
    const m = manual.get(task);
    const cell = (r?: Row) =>
      r ? `${r.score}${r.counts ? '' : ' ✗'} / ${r.it}${r.hitLimit ? ' (лимит)' : ''} / ${Math.round(r.tok / 1000)}k` : '—';
    console.log(`| ${task} | ${cell(a)} | ${cell(m)} |`);
  }
  const sum = (m: Map<string, Row>, pick: (r: Row) => number) =>
    tasks.reduce((acc, t) => acc + (m.get(t) ? pick(m.get(t)!) : 0), 0);
  const avg = (m: Map<string, Row>) => Math.round((sum(m, (r) => r.score) / tasks.length) * 10) / 10;
  console.log(`| **средний балл** | **${avg(auto)}** | **${avg(manual)}** |`);
  console.log(`| всего токенов | ${Math.round(sum(auto, (r) => r.tok) / 1000)}k | ${Math.round(sum(manual, (r) => r.tok) / 1000)}k |`);
  console.log(`| всего итераций | ${sum(auto, (r) => r.it)} | ${sum(manual, (r) => r.it)} |`);
}

// Two things the score alone does not separate: how tangled the lines are, and
// how much board the composition eats.
console.log('\n### Пересечения и компактность');
console.log('| задача | пересечений авто / вручную | площадь авто / вручную, млн px² |');
console.log('|---|---|---|');
const area = (exp: string, task: string): { cross: number; area: number } | null => {
  const dir = path.join(here, 'out', exp);
  const file = fs.readdirSync(dir).find((f) => f.startsWith(task) && f.endsWith('.json'));
  if (!file) return null;
  const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const xs = d.state.artifacts.map((a: { x: number; width: number }) => [a.x, a.x + a.width]).flat();
  const ys = d.state.artifacts.map((a: { y: number; height: number }) => [a.y, a.y + a.height]).flat();
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return { cross: boardQuality(d.state.artifacts, d.state.arrows).counts.arrowArrow, area: (w * h) / 1e6 };
};
for (const task of [...auto.keys()].sort()) {
  const a = area('AUTO', task);
  const m = area('MANUAL', task);
  if (!a || !m) continue;
  console.log(
    `| ${task} | ${a.cross} / ${m.cross} | ${a.area.toFixed(2)} / ${m.area.toFixed(2)} |`,
  );
}
