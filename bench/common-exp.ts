/** E05 vs E06 on the tasks that did not change between the runs. */
import { load } from './compare.js';

const a = load(process.argv[2] ?? 'E05');
const b = load(process.argv[3] ?? 'E06');
const changed = new Set((process.argv[4] ?? 'tight-row,overlap-stack').split(','));
const common = [...a.keys()].filter((t) => b.has(t) && !changed.has(t));

const avg = (m: Map<string, { score: number }>): number =>
  Math.round(common.reduce((s, t) => s + m.get(t)!.score, 0) / common.length);

console.log(`задач без переписанных: ${common.length}`);
console.log(`средний score: ${avg(a)} → ${avg(b)}`);
for (const task of common) {
  const diff = b.get(task)!.score - a.get(task)!.score;
  if (Math.abs(diff) >= 10) {
    console.log(`  ${task.padEnd(18)} ${a.get(task)!.score} → ${b.get(task)!.score} (${diff > 0 ? '+' : ''}${diff})`);
  }
}
