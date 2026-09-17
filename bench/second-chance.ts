/**
 * A crossing the router accepted because its own price list said crossing was
 * cheaper than going around. The judge says otherwise: on one board the detour
 * a person would draw scores 95 where the router's choice scores 86.
 *
 * So ask again, one arrow at a time, with the detour made worth taking — and
 * keep the answer only if the board actually improves.
 */
import { boardQuality, checkIntersections, computeArrowGeometries, routeArrows, tooTightToRoute, type Arrow } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const artifacts = d.state.artifacts;
let arrows: Arrow[] = d.state.arrows;

const before = boardQuality(artifacts, arrows);
console.log(`сейчас ${before.score}/100, штраф ${before.cost}, пересечений ${before.counts.arrowArrow}`);

const guilty = new Set<string>();
for (const f of checkIntersections(artifacts, arrows).findings) {
  if (f.kind === 'arrow_arrow') { guilty.add(f.arrowAId); guilty.add(f.arrowBId); }
}

let best = before.cost;
for (const id of guilty) {
  for (const price of [1200, 4000]) {
    const loose = arrows.map((a) => (a.id === id ? { ...a, bends: [], autoPorts: true } : a));
    if (!tooTightToRoute(artifacts, loose, [id]).ready) continue;
    const out = routeArrows(artifacts, loose, { arrowIds: [id], crossPenalty: price });
    if (out.refused) continue;
    const next = loose.map((a) => {
      const r = out.routed.find((x) => x.arrowId === a.id);
      return r ? { ...a, bends: r.bends, autoPorts: true,
        from: { ...a.from, side: r.fromSide, offset: r.fromOffset },
        to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
    });
    const q = boardQuality(artifacts, next);
    const g = computeArrowGeometries(artifacts, next).get(id)!;
    console.log(`  ${id} цена ${price}: ${q.score}/100, штраф ${q.cost}, пересечений ${q.counts.arrowArrow}`);
    if (q.cost < best - 0.01) {
      best = q.cost;
      arrows = next;
      console.log(`     принято, путь: ${g.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
    }
  }
}
const after = boardQuality(artifacts, arrows);
console.log(`\nитог: ${before.score} → ${after.score}, штраф ${before.cost} → ${after.cost}`);
