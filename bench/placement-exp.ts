/**
 * Who should place the nodes: the model, the layout, or the model's choice?
 *
 * Every arm runs the same tasks on the same model with the same limits. They
 * differ in the system prompt, the graph skill, and whether
 * `board_arrange_graph` is offered at all.
 *
 *   tsx bench/placement-exp.ts AUTO MANUAL CHOICE
 */
import { boardQuality, type Artifact } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskById } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Row {
  score: number;
  it: number;
  tok: number;
  cross: number;
  area: number;
  arranged: boolean;
  hitLimit: boolean;
}

const area = (artifacts: Artifact[]): number => {
  if (artifacts.length === 0) return 0;
  const w = Math.max(...artifacts.map((a) => a.x + a.width)) - Math.min(...artifacts.map((a) => a.x));
  const h = Math.max(...artifacts.map((a) => a.y + a.height)) - Math.min(...artifacts.map((a) => a.y));
  return (w * h) / 1e6;
};

const load = (exp: string): Map<string, Row> => {
  const out = new Map<string, Row>();
  const dir = path.join(here, 'out', exp);
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const q = boardQuality(d.state.artifacts, d.state.arrows);
    out.set(d.task, {
      score: q.score,
      it: d.iterations ?? 0,
      tok: d.usage?.promptTokens ?? 0,
      cross: q.counts.arrowArrow,
      area: area(d.state.artifacts),
      arranged: (d.toolHistogram?.board_arrange_graph ?? 0) > 0,
      hitLimit: d.termination === 'iteration_limit',
    });
  }
  return out;
};

const arms = process.argv.slice(2);
const data = arms.map((exp) => ({ exp, rows: load(exp) }));
const tasks = [...new Set(data.flatMap((d) => [...d.rows.keys()]))].sort();
const seeded = (t: string) => Boolean(taskById(t).seed);

const cell = (r?: Row) =>
  r
    ? `${r.score} / ${r.it}${r.hitLimit ? '!' : ''} / ${Math.round(r.tok / 1000)}k${r.arranged ? ' · авто' : ' · руками'}`
    : '—';

for (const [title, want] of [
  ['Пустой лист', (t: string) => !seeded(t)],
  ['Заполненное пространство', seeded],
] as Array<[string, (t: string) => boolean]>) {
  const group = tasks.filter(want);
  console.log(`\n### ${title}`);
  console.log(`| задача | ${arms.map((a) => `${a}: балл / итер / токены`).join(' | ')} |`);
  console.log(`|---${arms.map(() => '|---').join('')}|`);
  for (const task of group) {
    console.log(`| ${task} | ${data.map((d) => cell(d.rows.get(task))).join(' | ')} |`);
  }
  const stat = (pick: (r: Row) => number, label: string, round = 1) => {
    const cells = data.map((d) => {
      const rows = group.map((t) => d.rows.get(t)).filter(Boolean) as Row[];
      if (rows.length === 0) return '—';
      const v = rows.reduce((s, r) => s + pick(r), 0) / rows.length;
      return (Math.round(v * 10 ** round) / 10 ** round).toString();
    });
    console.log(`| **${label}** | ${cells.join(' | ')} |`);
  };
  stat((r) => r.score, 'средний балл');
  stat((r) => r.cross, 'пересечений в среднем');
  stat((r) => r.area, 'площадь, млн px²', 2);
  stat((r) => r.tok / 1000, 'токенов, k', 0);
}

console.log('\n### Всего');
console.log(`| показатель | ${arms.join(' | ')} |`);
console.log(`|---${arms.map(() => '|---').join('')}|`);
const total = (pick: (r: Row) => number, label: string, round = 0) => {
  const cells = data.map((d) => {
    const rows = [...d.rows.values()];
    const v = rows.reduce((s, r) => s + pick(r), 0);
    return (Math.round(v * 10 ** round) / 10 ** round).toString();
  });
  console.log(`| ${label} | ${cells.join(' | ')} |`);
};
total((r) => r.tok / 1000, 'входных токенов, k');
total((r) => r.it, 'итераций');
const chose = data.map((d) => {
  const rows = [...d.rows.values()];
  return `${rows.filter((r) => r.arranged).length} из ${rows.length}`;
});
console.log(`| раскладку звал | ${chose.join(' | ')} |`);
