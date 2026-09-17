/**
 * Screenshots of the three outcomes on the boards where they differ:
 * the board as the agent left it, what the router used to make of it, and
 * what it makes of it now.
 */
import { boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact, type BoardState } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './offline.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'detour');
fs.mkdirSync(outDir, { recursive: true });

const scan = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 0);
const maxRows = Number(process.argv.find((a) => a.startsWith('--max='))?.slice(6) ?? 12);
const wanted = new Set(
  (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean),
);

const relaid = (artifacts: Artifact[], arrows: Arrow[]): Arrow[] => {
  if (!tooTightToRoute(artifacts, arrows).ready) return arrows;
  const out = routeArrows(artifacts, arrows);
  if (out.refused) return arrows;
  return arrows.map((a) => {
    const r = out.routed.find((x) => x.arrowId === a.id);
    return r
      ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset }, autoPorts: true }
      : a;
  });
};

const search = (artifacts: Artifact[], arrows: Arrow[], detour: boolean) =>
  searchPorts(artifacts, arrows, {
    detour,
    lockedArrowIds: arrows.filter((a) => !a.autoPorts).map((a) => a.id),
  });

interface Shot { file: string; score: number; crossings: number }
const shoot = (state: BoardState, arrows: Arrow[], name: string): Shot => {
  const next = { ...state, arrows };
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), boardPng(next));
  const q = boardQuality(state.artifacts, arrows);
  return { file, score: q.score, crossings: q.metrics.crossings };
};

const rows: Array<{ name: string; was: Shot; before: Shot; after: Shot }> = [];
for (const item of scan > 0 ? loadCases().slice(0, scan) : loadCases()) {
  if (rows.length >= maxRows) break;
  const { artifacts, arrows } = item.state;
  if (arrows.length === 0) continue;
  const short = item.name.replace(/[^\w.-]+/g, '_');
  if (wanted.size > 0 && ![...wanted].some((w) => item.name.includes(w))) continue;

  const fresh = relaid(artifacts, arrows);
  const old = search(artifacts, fresh, false);
  const a = search(artifacts, fresh, true);
  const b = search(artifacts, arrows, true);
  const now = a.costAfter <= b.costAfter ? a : b;
  if (now.costAfter > old.costAfter - 0.5) continue;

  rows.push({
    name: item.name,
    was: shoot(item.state, arrows, `${short}__was`),
    before: shoot(item.state, old.arrows, `${short}__before`),
    after: shoot(item.state, now.arrows, `${short}__after`),
  });
  console.log(`${item.name}: ${old.arrows.length ? '' : ''}было ${boardQuality(artifacts, old.arrows).score} → стало ${boardQuality(artifacts, now.arrows).score}`);
}

const cell = (shot: Shot, title: string) => `
    <figure>
      <img src="${shot.file}" alt="${title}">
      <figcaption>${title} — <b>${shot.score}/100</b>, пересечений ${shot.crossings}</figcaption>
    </figure>`;

const html = `<!doctype html><meta charset="utf-8"><title>Обход снизу</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:32px;background:#f6f7f9;color:#14161a}
 h1{font-size:22px;margin:0 0 4px} p.lead{margin:0 0 28px;color:#555;max-width:70ch}
 section{background:#fff;border:1px solid #e3e5e9;border-radius:12px;padding:18px 20px;margin:0 0 22px}
 h2{font-size:16px;margin:0 0 14px;font-family:ui-monospace,monospace}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
 figure{margin:0} img{width:100%;border:1px solid #e3e5e9;border-radius:8px;background:#fff}
 figcaption{font-size:13px;color:#555;margin-top:6px}
 @media(max-width:900px){.row{grid-template-columns:1fr}}
</style>
<h1>Обход снизу: два хода вместо одного</h1>
<p class="lead">Слева — доска, как её оставил агент. В середине — что из неё делал роутер раньше. Справа — что он делает теперь, когда стрелке, попавшей в пересечение, разрешено сменить сторону <i>и</i> сдвинуть точку крепления одним ходом.</p>
${rows
  .map(
    (row) => `<section><h2>${row.name}</h2><div class="row">
${cell(row.was, 'как оставил агент')}
${cell(row.before, 'роутер раньше')}
${cell(row.after, 'роутер сейчас')}
</div></section>`,
  )
  .join('\n')}
`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`\n${rows.length} досок → ${path.join(outDir, 'index.html')}`);
