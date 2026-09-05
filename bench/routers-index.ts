/**
 * One page holding the router comparison for several boards side by side.
 *   tsx bench/routers-index.ts E08/wiki-anime E08/dense-arch E08/tree-org
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'routers');

const TITLES = [
  'наш роутер',
  'наш роутер + перебор портов',
  'libavoid сам выбирает точки крепления',
  'libavoid рисует, порты перебираем мы',
];

const main = () => {
  const cases = process.argv.slice(2);
  const blocks = cases.map((name) => {
    const slug = name.replace(/[^\w.-]/g, '_');
    // The per-case page already carries the measured numbers in its headings;
    // reuse them rather than recomputing and risking a different answer.
    const source = fs.readFileSync(path.join(OUT, `${slug}.html`), 'utf8');
    const notes = [...source.matchAll(/<h2>[^<]*<b>([^<]+)<\/b><\/h2>\s*<p class="muted">([^<]+)<\/p>/g)];
    const panels = TITLES.map((title, i) => `
      <figure>
        <figcaption>${title} <b>${notes[i]?.[1] ?? ''}</b><span>${notes[i]?.[2] ?? ''}</span></figcaption>
        <a href="${slug}-${i}.png" target="_blank"><img src="${slug}-${i}.png" alt="${title}"></a>
      </figure>`).join('');
    return `<section><h2>${name}</h2><div class="grid">${panels}</div></section>`;
  });

  const html = `<title>Сравнение роутеров</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.55 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:23px; margin:0 0 8px; }
  h2 { font-size:17px; margin:40px 0 12px; color:#9fb2d4; }
  .lead { color:#8b93a7; max-width:74ch; margin:0 0 6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:18px; }
  figure { margin:0; }
  figcaption { font-size:13px; margin-bottom:6px; }
  figcaption b { color:#7ddc9a; }
  figcaption span { display:block; color:#8b93a7; font-size:12px; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
</style>
<h1>Одна расстановка, четыре способа провести линии</h1>
<p class="lead">Блоки во всех картинках стоят одинаково — это наша раскладка, и она здесь не
сравнивается: смысловая расстановка и есть то, ради чего система существует. Различается
только прокладка линий.</p>
<p class="lead">Клик по картинке открывает её целиком.</p>
${blocks.join('\n')}`;

  const page = path.join(OUT, 'index.html');
  fs.writeFileSync(page, html);
  console.log(page);
};

main();
