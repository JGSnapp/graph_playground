/**
 * Is "go around the outside" reachable by pricing alone?
 *
 * The router charges 80 per crossing and one length unit per pixel, so a detour
 * of two thousand pixels never beats crossing five arrows. If raising the price
 * produces the routes a person would draw, this is a tuning problem; if it only
 * produces loops, it needs a different mechanism.
 */
import { boardQuality, routeArrows, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const apply = (arrows: Arrow[], routed: ReturnType<typeof routeArrows>['routed']): Arrow[] =>
  arrows.map((a) => {
    const m = routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, routing: 'orthogonal' as const,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });

const score = (artifacts: Artifact[], arrows: Arrow[], crossPenalty: number, outerRings = 0) => {
  if (!tooTightToRoute(artifacts, arrows).ready) return null;
  const r = routeArrows(artifacts, arrows, { crossPenalty, outerRings });
  const next = apply(arrows, r.routed);
  const q = boardQuality(artifacts, next);
  return { cost: q.cost, crossings: q.counts.arrowArrow, hooks: r.routed.filter((x) => x.hook).length,
    length: q.metrics.totalLength, detour: q.metrics.detour };
};

const VARIANTS: Array<[number, number]> = [[80, 0], [80, 2], [400, 2], [400, 3], [1200, 3]];
const totals = VARIANTS.map(() => ({ cost: 0, cross: 0, hooks: 0, len: 0, n: 0 }));

console.log('случай'.padEnd(26), VARIANTS.map(([p, r]) => `${p}/${r}кольц`.padStart(15)).join(''));
for (const item of loadCases()) {
  const row: string[] = [];
  VARIANTS.forEach(([p, rings], i) => {
    const r = score(item.state.artifacts, item.state.arrows, p, rings);
    if (!r) { row.push('—'.padStart(15)); return; }
    row.push(`${String(Math.round(r.cost)).padStart(4)}/${String(r.crossings).padStart(3)}×/${String(r.hooks)}h`.padStart(15));
    const t = totals[i];
    t.cost += r.cost; t.cross += r.crossings; t.hooks += r.hooks; t.len += r.length; t.n++;
  });
  console.log(item.name.slice(0, 26).padEnd(26), row.join(''));
}

console.log('\n| цена пересечения | средн. cost | пересечений | крюков | средн. длина линий |');
console.log('|---|---|---|---|---|');
VARIANTS.forEach(([p, rings], i) => {
  const t = totals[i];
  console.log(`| ${p} / ${rings} | ${Math.round(t.cost / t.n)} | ${t.cross} | ${t.hooks} | ${Math.round(t.len / t.n)} |`);
});
