/** Just the router: how many arrows leave a box stacked on top of each other. */
import { boardQuality, routeArrows, tooTightToRoute } from '@teca/shared';
import { loadCases } from './offline.js';

const acc = { cost: 0, merged: 0, crossings: 0, n: 0 };
const t0 = Date.now();
for (const item of loadCases()) {
  const { artifacts, arrows } = item.state;
  if (arrows.length === 0 || !tooTightToRoute(artifacts, arrows).ready) continue;
  const out = routeArrows(artifacts, arrows);
  if (out.refused) continue;
  const next = arrows.map((a) => {
    const r = out.routed.find((x) => x.arrowId === a.id);
    return r ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset }, autoPorts: true } : a;
  });
  const q = boardQuality(artifacts, next);
  acc.cost += q.cost; acc.merged += q.metrics.mergedArrows; acc.crossings += q.metrics.crossings; acc.n += 1;
}
console.log(`досок ${acc.n}, ${Math.round((Date.now() - t0) / 1000)}с`);
console.log(`средний штраф ${(acc.cost / acc.n).toFixed(2)}, слияний ${acc.merged}, пересечений ${acc.crossings}`);
