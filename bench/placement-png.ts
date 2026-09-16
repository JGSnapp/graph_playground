/**
 * All three placement arms side by side, one row per task.
 *
 *   tsx bench/placement-png.ts AUTO CHOICE MANUAL
 */
import { boardQuality, type Artifact } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskById } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arms = process.argv.slice(2);
const titles: Record<string, string> = {
  AUTO: 'Автоматическая раскладка',
  CHOICE: 'Агент выбирает способ',
  MANUAL: 'Расставляет агент',
};

const area = (artifacts: Artifact[]): number => {
  if (artifacts.length === 0) return 0;
  const w = Math.max(...artifacts.map((a) => a.x + a.width)) - Math.min(...artifacts.map((a) => a.x));
  const h = Math.max(...artifacts.map((a) => a.y + a.height)) - Math.min(...artifacts.map((a) => a.y));
  return (w * h) / 1e6;
};

const read = (exp: string, task: string) => {
  const dir = path.join(here, 'out', exp);
  const file = fs.readdirSync(dir).find((f) => f.startsWith(task) && f.endsWith('.json'));
  if (!file) return null;
  const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  return {
    png: `${exp}/${file.replace('.json', '.png')}`,
    score: boardQuality(d.state.artifacts, d.state.arrows).score,
    how: (d.toolHistogram?.board_arrange_graph ?? 0) > 0 ? 'раскладка' : 'руками',
    it: d.iterations ?? 0,
    tok: Math.round((d.usage?.promptTokens ?? 0) / 1000),
    area: area(d.state.artifacts).toFixed(2),
  };
};

const tasks = fs
  .readdirSync(path.join(here, 'out', arms[0]))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(here, 'out', arms[0], f), 'utf8')).task as string)
  .sort();

const sections = tasks.map((task) => {
  const seeded = Boolean(taskById(task).seed);
  const cells = arms
    .map((exp) => {
      const r = read(exp, task);
      if (!r) return `<figure><figcaption>${titles[exp] ?? exp}: нет</figcaption></figure>`;
      return `<figure>
  <figcaption>${titles[exp] ?? exp} <b>${r.score}/100</b>
    <span>${r.how} · ${r.it} итер · ${r.tok}k токенов · площадь ${r.area}</span></figcaption>
  <a href="${r.png}" target="_blank"><img src="${r.png}" alt="${task}"></a>
</figure>`;
    })
    .join('');
  return `<section><h2>${task} <i>${seeded ? 'заполненное пространство' : 'пустой лист'}</i></h2>
<div class="grid">${cells}</div></section>`;
});

const html = `<title>Три способа расстановки</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.55 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:23px; margin:0 0 8px; }
  h2 { font-size:17px; margin:38px 0 12px; color:#9fb2d4; }
  h2 i { font-style:normal; font-size:13px; color:#6f7789; margin-left:8px; }
  .lead { color:#8b93a7; max-width:78ch; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:16px; }
  figure { margin:0; } figcaption { font-size:13px; margin-bottom:6px; }
  figcaption b { color:#7ddc9a; }
  figcaption span { display:block; color:#8b93a7; font-size:12px; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
</style>
<h1>Кто расставляет блоки: раскладка, агент, или агент решает сам</h1>
<p class="lead">Одна и та же задача, одна модель, одни лимиты. Различается системный
промпт, скилл и доступен ли инструмент автоматической раскладки. Клик по картинке
открывает её целиком.</p>
${sections.join('\n')}`;

const out = path.join(here, 'out', 'placement.html');
fs.writeFileSync(out, html);
console.log(out);
