/**
 * Before and after this round, on the same boards and the same placement.
 *
 * "Before" reproduces the settings as they stood: no corner inset, no grid
 * outside the drawing, and a crossing priced below a single turn.
 */
import {
  QUALITY_WEIGHTS, arrangeGraph, boardQuality, computeArrowGeometries, routeArrows,
  searchPorts, setCornerInset, tooTightToRoute, type Arrow, type Artifact,
} from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './offline.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'round');
fs.mkdirSync(OUT, { recursive: true });

interface Setup { inset: number; rings: number; cross: number; cornerPort: number; even: boolean }

const build = (artifacts: Artifact[], arrows: Arrow[], setup: Setup): Arrow[] | null => {
  setCornerInset(setup.inset);
  (QUALITY_WEIGHTS as { cornerPort: number }).cornerPort = setup.cornerPort;
  const opts = { outerRings: setup.rings, crossPenalty: setup.cross };
  const fresh = arrows.map((a) => ({ ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined } }));
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh, opts);
  if (out.refused) return null;
  let next = fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, autoPorts: true,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
  const s = searchPorts(artifacts, next, {
    evenSpacing: setup.even,
    relay: (art, list, ids) => {
      if (!tooTightToRoute(art, list, ids).ready) return null;
      const o = routeArrows(art, list, { ...opts, arrowIds: ids });
      if (o.refused) return null;
      return list.map((a) => {
        const r = o.routed.find((x) => x.arrowId === a.id);
        return r ? { ...a, bends: r.bends, routing: 'orthogonal' as const,
          from: { ...a.from, side: r.fromSide, offset: r.fromOffset },
          to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
      });
    },
  });
  if (s.costAfter < s.costBefore) next = s.arrows;
  return next;
};

// The placement is shared by both columns, so only the routing differs.
const BEFORE: Setup = { inset: 0, rings: 0, cross: 80, cornerPort: 0, even: false };
const AFTER: Setup = { inset: 14, rings: 0, cross: 200, cornerPort: 3, even: true };

/** Ports pressed against an edge, read off the drawn geometry. */
const onCorner = (artifacts: Artifact[], arrows: Arrow[]): number => {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const geometries = computeArrowGeometries(artifacts, arrows);
  let count = 0;
  for (const arrow of arrows) {
    const g = geometries.get(arrow.id);
    if (!g) continue;
    for (const [id, side, offset] of [
      [arrow.from.artifactId, g.fromSide, g.fromOffset],
      [arrow.to.artifactId, g.toSide, g.toOffset],
    ] as const) {
      const box = byId.get(id);
      if (!box) continue;
      const len = side === 'top' || side === 'bottom' ? box.width : box.height;
      if (Math.min(offset, 1 - offset) * len < 14) count += 1;
    }
  }
  return count;
};

const main = () => {
  const wanted = process.argv.slice(2);
  const sections: string[] = [];

  for (const want of wanted) {
    const item = loadCases().find((c) => c.name.includes(want));
    if (!item) { console.error(`нет случая «${want}»`); continue; }
    const slug = want.replace(/[^\w.-]/g, '_');
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });

    const panels = ([['было', BEFORE], ['стало', AFTER]] as const).map(([label, setup], i) => {
      const arrows = build(placed.artifacts, placed.arrows, setup);
      if (!arrows) return `<figure><figcaption>${label}: роутер отказался</figcaption></figure>`;
      (QUALITY_WEIGHTS as { cornerPort: number }).cornerPort = 0;
      const q = boardQuality(placed.artifacts, arrows);
      const file = `${slug}-${i}.png`;
      fs.writeFileSync(path.join(OUT, file), boardPng({ artifacts: placed.artifacts, arrows }, 1300));
      return `<figure>
  <figcaption>${label} <b>${q.score}/100</b>
    <span>пересечений ${q.counts.arrowArrow} · поворотов ${q.metrics.drawnTurns} · портов у края ${onCorner(placed.artifacts, arrows)}</span>
  </figcaption>
  <a href="${file}" target="_blank"><img src="${file}" alt="${label}"></a>
</figure>`;
    });
    sections.push(`<section><h2>${want}</h2><div class="grid">${panels.join('')}</div></section>`);
  }

  const html = `<title>Итерации: углы, повороты, обход</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.55 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:23px; margin:0 0 10px; }
  h2 { font-size:17px; margin:40px 0 12px; color:#9fb2d4; }
  .lead { color:#8b93a7; max-width:76ch; margin:0 0 4px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:18px; }
  figure { margin:0; }
  figcaption { font-size:13px; margin-bottom:6px; }
  figcaption b { color:#7ddc9a; }
  figcaption span { display:block; color:#8b93a7; font-size:12px; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
  ol { color:#c9cedb; max-width:76ch; } li { margin:6px 0; }
</style>
<h1>Три изменения этого круга</h1>
<ol>
  <li><b>Каждая сторона раскладывается ровно.</b> Перебор двигает порты по
      одному и принимает любое неухудшающее движение, так что сторона
      оставалась неровной: три стрелки на одном ребре стояли там, где поиск
      остановился. Метрика ровности не видит, поэтому её никто не наводил — и
      веер подчинённых, который читался симметрично, выходил вразнобой. Теперь
      стороны выравниваются в конце, с сохранением порядка.</li>
  <li><b>Порт у края теперь чего-то стоит.</b> Раньше метрика его не видела
      вовсе, поэтому ничто в системе не имело причины его двигать: перебор
      принимает только строгие улучшения, а уход с угла улучшением не был.
      Девять из десяти таких портов держали прямую линию — их удалось сдвинуть
      вместе с партнёром, не сгибая её.</li>
  <li><b>Порты не садятся в угол.</b> Отступ 14px — скругление блока (10px)
      плюс немного прямой кромки. Действует только там, где порт
      <i>придумывается</i>, и не действует там, где он считывается с уже
      проложенной трассы или задан явно: первая версия правила двигала и такие
      порты и ломала прямые линии — две доски со 100 баллов падали до 76 и 86.</li>
  <li><b>Штраф считает нарисованные повороты, а не сохранённые изгибы.</b>
      Стрелка, которая отходит вбок и сразу возвращается, хранила два изгиба и
      проходила бесплатно, рисуя четыре видимых поворота.</li>
  <li><b>Пересечение подорожало.</b> Оно стоило 80 при цене поворота 120 — то
      есть перечеркнуть чужую линию всегда было дешевле, чем шагнуть в сторону.
      Теперь 200: на 66 досках 27 стали лучше, 2 хуже, худшая потеря +4.3.
      Другие цены проверены и проигрывают по всем четырём числам сразу.</li>
</ol>
<p class="lead">Блоки в обеих картинках стоят одинаково — различается только
прокладка линий.</p>
${sections.join('\n')}`;

  const page = path.join(OUT, 'index.html');
  fs.writeFileSync(page, html);
  console.log(page);
};

main();
