/** Offline: current placement vs arrangeGraph (layout + routing + scoring). */
import { arrangeGraph, boardQuality, routeArrows, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './offline.js';
import { observe } from './metrics.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pngDir = process.argv.includes('--png') ? path.resolve(here, 'out/layout') : null;
if (pngDir) fs.mkdirSync(pngDir, { recursive: true });

const routeOnly = (artifacts: Artifact[], arrows: Arrow[]) => {
  if (!tooTightToRoute(artifacts, arrows).ready) return boardQuality(artifacts, arrows);
  const r = routeArrows(artifacts, arrows);
  const next = arrows.map((a) => {
    const m = r.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, routing: 'orthogonal' as const,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
  return boardQuality(artifacts, next);
};

let sumRoute = 0, sumArr = 0, n = 0, better = 0;
console.log('случай'.padEnd(34), 'узл свз', '  as-is', '  route', ' arrange', ' выбор', ' cross', ' раздел');
for (const item of loadCases()) {
  const { artifacts, arrows } = item.state;
  const asIs = boardQuality(artifacts, arrows);
  const routed = routeOnly(artifacts, arrows);
  const arranged = arrangeGraph(artifacts, arrows);
  const obs = observe({ artifacts: arranged.artifacts, arrows: arranged.arrows });
  console.log(item.name.slice(0, 34).padEnd(34),
    String(artifacts.length).padStart(3), String(arrows.length).padStart(3),
    String(asIs.cost).padStart(7), String(routed.cost).padStart(7),
    String(arranged.qualityAfter.cost).padStart(8),
    `${arranged.chosen.direction}x${arranged.chosen.spacingScale}`.padStart(7),
    String(arranged.layout.crossings).padStart(6),
    String(obs.separation).padStart(9));
  sumRoute += routed.cost; sumArr += arranged.qualityAfter.cost; n++;
  if (arranged.qualityAfter.cost < routed.cost) better++;
  if (pngDir) fs.writeFileSync(path.join(pngDir, `${item.name.replace(/[^\w.-]/g, '_')}.png`),
    boardPng({ artifacts: arranged.artifacts, arrows: arranged.arrows }));
}
console.log(`\nсредний cost: route=${Math.round(sumRoute / n)} arrange=${Math.round(sumArr / n)} | arrange лучше в ${better}/${n}`);
