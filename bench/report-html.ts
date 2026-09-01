/**
 * Builds a local HTML page comparing two experiments side by side, so results
 * can actually be looked at rather than only measured.
 *
 *   tsx bench/report-html.ts E02 E03
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');

interface Row {
  task: string;
  probes: string;
  score: number;
  ok: boolean;
  grade: string;
  iterations: number;
  refusals: number;
  crossings: number;
  aspect: number;
  png: string;
}

const load = (exp: string): Map<string, Row> => {
  const dir = path.join(OUT, exp);
  const rows = new Map<string, Row>();
  if (!fs.existsSync(dir)) return rows;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    rows.set(r.task, {
      task: r.task,
      probes: r.probes ?? '',
      score: r.quality.score,
      ok: r.ok,
      grade: r.quality.grade,
      iterations: r.iterations ?? 0,
      refusals: (r.refusals ?? []).length,
      crossings: r.quality.counts.arrowArrow,
      aspect: r.observations.aspect,
      png: `${exp}/${file.replace('.json', '.png')}`,
    });
  }
  return rows;
};

const [a, b] = [process.argv[2] ?? 'E02', process.argv[3] ?? 'E03'];
const left = load(a);
const right = load(b);
const tasks = [...new Set([...left.keys(), ...right.keys()])].sort(
  (x, y) => (right.get(y)?.score ?? 0) - (right.get(x)?.score ?? 0),
);

const delta = (from?: number, to?: number): string => {
  if (from == null || to == null) return '';
  const d = to - from;
  if (d === 0) return '<span class="same">без изменений</span>';
  return d > 0
    ? `<span class="up">+${d}</span>`
    : `<span class="down">${d}</span>`;
};

const card = (exp: string, row?: Row): string => {
  if (!row) return `<div class="pane"><div class="head">${exp}</div><p class="muted">нет данных</p></div>`;
  return `<div class="pane">
  <div class="head">${exp} <b class="${row.ok ? 'ok' : 'bad'}">${row.score}/100</b>
    <span class="muted">${row.grade}${row.ok ? ' · ok' : ''}</span></div>
  <div class="meta">${row.iterations} итераций · ${row.crossings} пересечений · отказов ${row.refusals} · пропорция ${row.aspect}</div>
  <a href="${row.png}" target="_blank"><img src="${row.png}" alt="${row.task} ${exp}"></a>
</div>`;
};

const sections = tasks
  .map((task) => {
    const l = left.get(task);
    const r = right.get(task);
    return `<section>
  <h2>${task} ${delta(l?.score, r?.score)}</h2>
  <p class="muted">${r?.probes ?? l?.probes ?? ''}</p>
  <div class="pair">${card(a, l)}${card(b, r)}</div>
</section>`;
  })
  .join('\n');

const stats = (rows: Row[]) =>
  rows.length === 0
    ? { score: 0, ok: 0, crossings: 0 }
    : {
        score: Math.round(rows.reduce((s, x) => s + x.score, 0) / rows.length),
        ok: rows.filter((x) => x.ok).length,
        crossings: rows.reduce((s, x) => s + x.crossings, 0),
      };
const sl = stats([...left.values()]);
const sr = stats([...right.values()]);

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Сравнение прогонов ${a} → ${b}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #0b0d11; color: #e8e8ea;
         font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 40px 0 2px; }
  .muted { color: #8b93a7; font-size: 13px; margin: 2px 0 12px; }
  .summary { display: flex; gap: 28px; margin: 18px 0 8px; padding: 14px 18px;
             background: #12151c; border: 1px solid #232733; border-radius: 10px; }
  .summary div b { display: block; font-size: 20px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .pane { background: #12151c; border: 1px solid #232733; border-radius: 10px;
          padding: 12px; min-width: 0; }
  .head { font-size: 13px; color: #8b93a7; margin-bottom: 2px; }
  .head b { font-size: 18px; color: #e8e8ea; }
  .meta { font-size: 12px; color: #6f778a; margin-bottom: 10px; }
  img { width: 100%; height: auto; display: block; border-radius: 6px;
        background: #0e1014; border: 1px solid #1c2029; }
  .ok { color: #7ddc9a; } .bad { color: #e8e8ea; }
  .up { color: #7ddc9a; font-size: 14px; } .down { color: #e8767a; font-size: 14px; }
  .same { color: #6f778a; font-size: 14px; }
  @media (max-width: 900px) { .pair { grid-template-columns: 1fr; } }
</style></head>
<body>
<h1>Сравнение прогонов ${a} → ${b}</h1>
<p class="muted">Модель deepseek-v4-flash, пул из ${tasks.length} задач. Клик по картинке — открыть в полном размере.</p>
<div class="summary">
  <div><b>${sl.score} → ${sr.score}</b>средний score</div>
  <div><b>${sl.ok}/${left.size} → ${sr.ok}/${right.size}</b>без жёстких конфликтов</div>
  <div><b>${sl.crossings} → ${sr.crossings}</b>пересечений стрелок</div>
</div>
${sections}
</body></html>`;

const file = path.join(OUT, `compare-${a}-${b}.html`);
fs.writeFileSync(file, html);
console.log(file);
