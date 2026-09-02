/**
 * Renders one graph laid out by each engine, side by side, into an HTML page.
 * Numbers say which is better; a picture says why.
 *
 *   tsx bench/engines-png.ts wiki-anime
 */
import { arrangeGraph, boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './offline.js';
import { boardPng } from './render.js';

const require = createRequire(import.meta.url);
const dagre = require('@dagrejs/dagre');
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'engines');
fs.mkdirSync(OUT, { recursive: true });

/** Same rule our layout uses: spacing scaled to the median node. */
const spacingFor = (artifacts: Artifact[], horizontal: boolean) => {
  const pick = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const along = pick(artifacts.map((a) => (horizontal ? a.width : a.height)));
  const cross = pick(artifacts.map((a) => (horizontal ? a.height : a.width)));
  return {
    node: Math.round(Math.max(44, cross * 0.55)),
    layer: Math.round(Math.max(130, along * 1.15)),
  };
};

const edgesOf = (arrows: Arrow[], ids: Set<string>) =>
  arrows
    .filter((a) => ids.has(a.from.artifactId) && ids.has(a.to.artifactId))
    .filter((a) => a.from.artifactId !== a.to.artifactId);

const byDagre = (artifacts: Artifact[], arrows: Arrow[], horizontal: boolean): Artifact[] => {
  const g = new dagre.graphlib.Graph();
  const gap = spacingFor(artifacts, horizontal);
  g.setGraph({ rankdir: horizontal ? 'LR' : 'TB', nodesep: gap.node, ranksep: gap.layer });
  g.setDefaultEdgeLabel(() => ({}));
  for (const a of artifacts) g.setNode(a.id, { width: a.width, height: a.height });
  const ids = new Set(artifacts.map((a) => a.id));
  for (const e of edgesOf(arrows, ids)) g.setEdge(e.from.artifactId, e.to.artifactId);
  dagre.layout(g);
  return artifacts.map((a) => {
    const n = g.node(a.id);
    return n ? { ...a, x: Math.round(n.x - a.width / 2), y: Math.round(n.y - a.height / 2) } : a;
  });
};

const byElk = async (artifacts: Artifact[], arrows: Arrow[], horizontal: boolean): Promise<Artifact[]> => {
  const ids = new Set(artifacts.map((a) => a.id));
  const laid = (await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': String(spacingFor(artifacts, horizontal).node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacingFor(artifacts, horizontal).layer),
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: artifacts.map((a) => ({ id: a.id, width: a.width, height: a.height })),
    edges: edgesOf(arrows, ids).map((e, i) => ({
      id: `e${i}`, sources: [e.from.artifactId], targets: [e.to.artifactId],
    })),
  })) as { children?: Array<{ id: string; x?: number; y?: number }> };
  const at = new Map((laid.children ?? []).map((c) => [c.id, c]));
  return artifacts.map((a) => {
    const c = at.get(a.id);
    return c ? { ...a, x: Math.round(c.x ?? a.x), y: Math.round(c.y ?? a.y) } : a;
  });
};

const lay = (artifacts: Artifact[], arrows: Arrow[], withSearch: boolean) => {
  const released = arrows.map((a) => ({
    ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));
  if (!tooTightToRoute(artifacts, released).ready) return null;
  const out = routeArrows(artifacts, released);
  if (out.refused) return null;
  let next = released.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, autoPorts: true,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });
  if (withSearch) {
    const searched = searchPorts(artifacts, next);
    if (searched.costAfter < searched.costBefore) next = searched.arrows;
  }
  return next;
};

const main = async () => {
  const want = process.argv[2] ?? 'wiki-anime';
  // A case name carries a folder prefix; the file name must not.
  const slug = want.replace(/[^\w.-]/g, '_');
  const item = loadCases().find((c) => c.name.includes(want));
  if (!item) {
    console.error(`не нашёл случай с «${want}»`);
    process.exit(1);
  }
  const { artifacts, arrows } = item.state;

  const panels: Array<{ title: string; artifacts: Artifact[]; arrows: Arrow[] }> = [];

  const ours = arrangeGraph(artifacts, arrows);
  panels.push({ title: 'наша раскладка + перебор портов', artifacts: ours.artifacts, arrows: ours.arrows });

  for (const [name, place] of [
    ['ELK layered', (h: boolean) => byElk(artifacts, arrows, h)],
    ['dagre', (h: boolean) => Promise.resolve(byDagre(artifacts, arrows, h))],
  ] as const) {
    for (const withSearch of [false, true]) {
      let best: { artifacts: Artifact[]; arrows: Arrow[]; cost: number } | null = null;
      for (const horizontal of [true, false]) {
        const placed = await place(horizontal);
        const laid = lay(placed, arrows, withSearch);
        if (!laid) continue;
        const cost = boardQuality(placed, laid).cost;
        if (!best || cost < best.cost) best = { artifacts: placed, arrows: laid, cost };
      }
      if (best) {
        panels.push({
          title: withSearch ? `${name} + наш перебор портов` : name,
          artifacts: best.artifacts,
          arrows: best.arrows,
        });
      }
    }
  }

  const cards = panels.map((panel, index) => {
    const q = boardQuality(panel.artifacts, panel.arrows);
    const file = `${slug}-${index}.png`;
    fs.writeFileSync(path.join(OUT, file), boardPng({ artifacts: panel.artifacts, arrows: panel.arrows }, 1200));
    return `<section>
  <h2>${panel.title} <b>${q.score}/100</b></h2>
  <p class="muted">штраф ${q.cost} · пересечений ${q.counts.arrowArrow} · наложений ${q.counts.artifactArtifact}</p>
  <a href="${file}" target="_blank"><img src="${file}" alt="${panel.title}"></a>
</section>`;
  });

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Движки раскладки: ${want}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#0b0d11; color:#e8e8ea;
         font:15px/1.5 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:22px; margin:0 0 6px; } h2 { font-size:16px; margin:32px 0 2px; }
  h2 b { color:#7ddc9a; } .muted { color:#8b93a7; font-size:13px; margin:2px 0 10px; }
  img { width:100%; height:auto; border-radius:8px; background:#0e1014; border:1px solid #1c2029; }
</style></head><body>
<h1>Один и тот же граф разными движками — ${want}</h1>
<p class="muted">Узлы расставляет каждый движок сам, стрелки прокладывает один и тот же роутер,
оценивает одна и та же метрика. Разница — только в расстановке.</p>
${cards.join('\n')}
</body></html>`;

  const page = path.join(OUT, `${slug}.html`);
  fs.writeFileSync(page, html);
  console.log(page);
};

main();
