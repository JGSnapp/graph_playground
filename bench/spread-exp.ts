/** How noisy is one run? Median, range and per-repeat scores for E07. */
import { load } from './compare.js';

const exp = process.argv[2] ?? 'E07';
const rows = [...load(exp).values()].sort((a, b) => b.spread - a.spread);

console.log('задача'.padEnd(18), 'медиана', 'разброс', 'без конфликтов', 'итераций');
for (const r of rows) {
  console.log(
    r.task.padEnd(18),
    String(r.score).padStart(7),
    String(r.spread).padStart(7),
    `${Math.round(r.okShare * 100)}%`.padStart(14),
    String(r.iterations).padStart(8),
  );
}
const spread = rows.map((r) => r.spread).sort((a, b) => a - b);
console.log(
  `\nразброс: минимум ${spread[0]}, медиана ${spread[spread.length >> 1]}, максимум ${spread[spread.length - 1]}`,
);
console.log(
  `Разница меньше ${spread[spread.length >> 1]} пунктов на одной задаче — это шум, а не результат.`,
);
