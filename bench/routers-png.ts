/**
 * One board drawn by each router, on one fixed placement — ours.
 *
 *   tsx bench/routers-png.ts E08/wiki-anime
 */
import {
  arrangeGraph,
  boardQuality,
  routeArrows,
  searchPorts,
  tooTightToRoute,
  type Arrow,
  type Artifact,
} from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvoid, routeAtPorts, routeFree } from './libavoid.js';
import { loadCases } from './offline.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'routers');
fs.mkdirSync(OUT, { recursive: true });

const released = (arrows: Arrow[]): Arrow[] =>
  arrows.map((a) => ({
    ...a,
    bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));

const ours = (artifacts: Artifact[], arrows: Arrow[], withSearch: boolean): Arrow[] | null => {
  const fresh = released(arrows);
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  let next = fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? {
          ...a, bends: m.bends, autoPorts: true,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset },
        }
      : a;
  });
  if (withSearch) {
    const searched = searchPorts(artifacts, next);
    if (searched.costAfter < searched.costBefore) next = searched.arrows;
  }
  return next;
};

const main = async () => {
  const want = process.argv[2] ?? 'E08/wiki-anime';
  const slug = want.replace(/[^\w.-]/g, '_');
  const item = loadCases().find((c) => c.name.includes(want));
  if (!item) {
    console.error(`не нашёл случай с «${want}»`);
    process.exit(1);
  }

  const Avoid = await loadAvoid();
  const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
  const { artifacts } = placed;
  const arrows = placed.arrows;

  const plain = ours(artifacts, arrows, false);
  if (!plain) {
    console.error('роутер отказался на этой доске');
    process.exit(1);
  }

  const panels: Array<{ title: string; arrows: Arrow[] }> = [
    { title: 'наш роутер', arrows: plain },
    { title: 'наш роутер + перебор портов', arrows: ours(artifacts, arrows, true) ?? plain },
    { title: 'libavoid сам выбирает точки крепления', arrows: routeFree(Avoid, artifacts, arrows) },
  ];

  const start = routeAtPorts(Avoid, artifacts, plain) ?? plain;
  const searched = searchPorts(artifacts, start, {
    relay: (a, list, ids) => routeAtPorts(Avoid, a, list, ids),
  });
  panels.push({
    title: 'libavoid + наш перебор портов',
    arrows: searched.costAfter < searched.costBefore ? searched.arrows : start,
  });

  const cards = panels.map((panel, index) => {
    const q = boardQuality(artifacts, panel.arrows);
    const bends = panel.arrows.reduce((s, a) => s + a.bends.length, 0);
    const file = `${slug}-${index}.png`;
    fs.writeFileSync(path.join(OUT, file), boardPng({ artifacts, arrows: panel.arrows }, 1300));
    return `<section>
  <h2>${panel.title} <b>${q.score}/100</b></h2>
  <p class="muted">штраф ${q.cost} · пересечений ${q.counts.arrowArrow} · изгибов ${bends}</p>
  <a href="${file}" target="_blank"><img src="${file}" alt="${panel.title}"></a>
</section>`;
  });

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Роутеры: ${want}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.5 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:22px; margin:0 0 6px; } h2 { font-size:16px; margin:34px 0 2px; }
  h2 b { color:#7ddc9a; } .muted { color:#8b93a7; font-size:13px; margin:2px 0 10px; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
</style></head><body>
<h1>Одна расстановка, разные роутеры — ${want}</h1>
<p class="muted">Блоки стоят одинаково во всех четырёх картинках: это наша раскладка, и она не
сравнивается. Различается только то, как проведены линии.</p>
${cards.join('\n')}
</body></html>`;

  const page = path.join(OUT, `${slug}.html`);
  fs.writeFileSync(page, html);
  console.log(page);
};

main();
