/**
 * A crossing the router accepted because going around cost more than crossing.
 * Re-routing just those arrows at a much higher crossing price asks the other
 * question: what would it look like if the detour were worth it?
 */
import { boardQuality, checkIntersections, computeArrowGeometries, routeArrows, tooTightToRoute, type Arrow } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const artifacts = d.state.artifacts;
const arrows: Arrow[] = d.state.arrows;

const before = boardQuality(artifacts, arrows);
console.log(`сейчас ${before.score}/100, штраф ${before.cost}, пересечений ${before.counts.arrowArrow}`);

const guilty = new Set<string>();
for (const f of checkIntersections(artifacts, arrows).findings) {
  if (f.kind === 'arrow_arrow') { guilty.add(f.arrowAId); guilty.add(f.arrowBId); }
}
const ids = [...guilty];
console.log(`в пересечениях участвуют: ${ids.join(', ')}`);

for (const price of [200, 800, 2000, 6000]) {
  const loose = arrows.map((a) => (guilty.has(a.id) ? { ...a, bends: [], autoPorts: true } : a));
  if (!tooTightToRoute(artifacts, loose, ids).ready) { console.log(`  цена ${price}: гейт отказал`); continue; }
  const out = routeArrows(artifacts, loose, { arrowIds: ids, crossPenalty: price });
  if (out.refused) { console.log(`  цена ${price}: отказ`); continue; }
  const next = loose.map((a) => {
    const r = out.routed.find((x) => x.arrowId === a.id);
    return r ? { ...a, bends: r.bends, autoPorts: true,
      from: { ...a.from, side: r.fromSide, offset: r.fromOffset },
      to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
  });
  const q = boardQuality(artifacts, next);
  const paths = ids
    .map((id) => computeArrowGeometries(artifacts, next).get(id))
    .filter(Boolean)
    .map((g) => g!.points.length);
  console.log(`  цена ${price}: ${q.score}/100, пересечений ${q.counts.arrowArrow}, штраф ${q.cost}, точек в путях ${paths.join('/')}`);
}
