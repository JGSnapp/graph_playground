/** Side by side: what each optimisation variant cost and scored. */
import { boardQuality } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskById } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Row { score: number; it: number; tok: number; sec: number; counts: boolean }

const load = (exp: string): Map<string, Row> => {
  const dir = path.join(here, 'out', exp);
  const out = new Map<string, Row>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const q = boardQuality(d.state.artifacts, d.state.arrows);
    const connected = new Set<string>();
    for (const a of d.state.arrows) { connected.add(a.from.artifactId); connected.add(a.to.artifactId); }
    const isolated = d.state.artifacts.filter((a: { id: string }) => !connected.has(a.id));
    const counts = !taskById(d.task).graph ||
      (d.state.arrows.length > 0 && isolated.length <= d.state.artifacts.length / 2);
    out.set(d.task, {
      score: q.score, it: d.iterations ?? 0,
      tok: d.usage?.promptTokens ?? 0, sec: Math.round(d.ms / 1000), counts,
    });
  }
  return out;
};

const main = () => {
  const exps = process.argv.slice(2);
  const data = exps.map((e) => ({ exp: e, rows: load(e) }));
  const tasks = [...new Set(data.flatMap((d) => [...d.rows.keys()]))].sort();

  console.log('\n| задача | ' + exps.map((e) => `${e}: балл / итер / токены`).join(' | ') + ' |');
  console.log('|---' + exps.map(() => '|---').join('') + '|');
  for (const task of tasks) {
    const cells = data.map(({ rows }) => {
      const r = rows.get(task);
      if (!r) return '—';
      return `${r.score}${r.counts ? '' : ' ✗'} / ${r.it} / ${Math.round(r.tok / 1000)}k`;
    });
    console.log(`| ${task} | ${cells.join(' | ')} |`);
  }

  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log('\n| показатель | ' + exps.join(' | ') + ' |');
  console.log('|---' + exps.map(() => '|---').join('') + '|');
  const stat = (pick: (r: Row) => number, agg: (xs: number[]) => number, label: string) => {
    const cells = data.map(({ rows }) => {
      const valid = [...rows.values()].filter((r) => r.counts);
      return valid.length ? Math.round(agg(valid.map(pick)) * 10) / 10 : 0;
    });
    console.log(`| ${label} | ${cells.join(' | ')} |`);
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  stat((r) => r.score, (xs) => sum(xs) / xs.length, 'средний балл');
  stat((r) => r.score, med, 'медиана балла');
  stat((r) => r.it, med, 'медиана итераций');
  stat((r) => r.tok / 1000, med, 'медиана токенов, k');
  stat((r) => r.tok / 1000, sum, 'всего токенов, k');
  stat((r) => r.sec, sum, 'всего секунд');

  // tight-row swings by a factor of two between runs on its own, so the totals
  // are also given without it.
  console.log('\nБез tight-row (он один даёт разброс вдвое между прогонами):');
  console.log('| показатель | ' + exps.join(' | ') + ' |');
  console.log('|---' + exps.map(() => '|---').join('') + '|');
  const statNoTight = (pick: (r: Row) => number, agg: (xs: number[]) => number, label: string) => {
    const cells = data.map(({ rows }) => {
      const valid = [...rows.entries()].filter(([t, r]) => r.counts && t !== 'tight-row').map(([, r]) => r);
      return valid.length ? Math.round(agg(valid.map(pick)) * 10) / 10 : 0;
    });
    console.log(`| ${label} | ${cells.join(' | ')} |`);
  };
  statNoTight((r) => r.score, (xs) => sum(xs) / xs.length, 'средний балл');
  statNoTight((r) => r.it, med, 'медиана итераций');
  statNoTight((r) => r.tok / 1000, sum, 'всего токенов, k');
};
main();
