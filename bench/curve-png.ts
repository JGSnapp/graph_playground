/**
 * One board drawn both ways, so the curved mode can be judged by eye.
 *
 *   tsx bench/curve-png.ts E12/wiki-anime
 */
import type { Arrow } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'curved');
fs.mkdirSync(OUT, { recursive: true });

const main = () => {
  const wanted = process.argv.slice(2);
  const sections: string[] = [];

  for (const want of wanted) {
    const [exp, task] = want.split('/');
    const dir = path.join(here, 'out', exp);
    const file = fs.readdirSync(dir).find((f) => f.startsWith(task) && f.endsWith('.json'));
    if (!file) {
      console.error(`нет ${want}`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const slug = want.replace(/[^\w.-]/g, '_');

    const panels = ([['прямые углы', 'orthogonal'], ['скруглённые', 'curved']] as const).map(
      ([title, routing], index) => {
        const arrows: Arrow[] = d.state.arrows.map((a: Arrow) => ({ ...a, routing }));
        const name = `${slug}-${index}.png`;
        fs.writeFileSync(path.join(OUT, name), boardPng({ ...d.state, arrows }, 1300));
        return `<figure><figcaption>${title}</figcaption>
  <a href="${name}" target="_blank"><img src="${name}" alt="${title}"></a></figure>`;
      },
    );
    sections.push(`<section><h2>${want}</h2><div class="grid">${panels.join('')}</div></section>`);
  }

  const html = `<title>Кривые линии</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.55 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:23px; margin:0 0 8px; }
  h2 { font-size:17px; margin:36px 0 12px; color:#9fb2d4; }
  .lead { color:#8b93a7; max-width:76ch; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:18px; }
  figure { margin:0; } figcaption { font-size:13px; margin-bottom:6px; color:#9fb2d4; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
</style>
<h1>Режим кривых линий</h1>
<p class="lead">Маршрут в обеих колонках один и тот же — те же порты, те же изгибы,
та же ломаная. Различается только то, как нарисованы углы, поэтому доску можно
переключать между режимами, ничего не перекладывая, и все замеры сохраняют смысл.</p>
${sections.join('\n')}`;

  const page = path.join(OUT, 'index.html');
  fs.writeFileSync(page, html);
  console.log(page);
};
main();
