/** Does searching over port attachments remove the crossings pricing could not? */
import { boardQuality, checkIntersections, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const laid = (artifacts: Artifact[], arrows: Arrow[]): Arrow[] | null => {
  if (!tooTightToRoute(artifacts, arrows).ready) return null;
  const out = routeArrows(artifacts, arrows);
  return arrows.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, routing: 'orthogonal' as const,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });
};

const shared = (arrows: Arrow[], artifacts: Artifact[]): number =>
  checkIntersections(artifacts, arrows).findings.filter((f) => {
    if (f.kind !== 'arrow_arrow') return false;
    const a = arrows.find((x) => x.id === f.arrowAId)!;
    const b = arrows.find((x) => x.id === f.arrowBId)!;
    const ends = new Set([a.from.artifactId, a.to.artifactId]);
    return ends.has(b.from.artifactId) || ends.has(b.to.artifactId);
  }).length;

const acc = { before: 0, after: 0, xBefore: 0, xAfter: 0, sBefore: 0, sAfter: 0, swaps: 0, tried: 0, n: 0 };
console.log('случай'.padEnd(30), 'cost', 'пересечений', 'из них общих', 'обменов');
for (const item of loadCases()) {
  const base = laid(item.state.artifacts, item.state.arrows);
  if (!base) continue;
  const q0 = boardQuality(item.state.artifacts, base);
  const res = searchPorts(item.state.artifacts, base);
  const q1 = boardQuality(item.state.artifacts, res.arrows);
  const s0 = shared(base, item.state.artifacts);
  const s1 = shared(res.arrows, item.state.artifacts);
  console.log(item.name.slice(0, 30).padEnd(30),
    `${String(Math.round(q0.cost)).padStart(5)}→${String(Math.round(q1.cost)).padEnd(5)}`,
    `${String(q0.counts.arrowArrow).padStart(4)}→${String(q1.counts.arrowArrow).padEnd(4)}`,
    `${String(s0).padStart(6)}→${String(s1).padEnd(6)}`,
    String(res.swaps).padStart(7));
  acc.before += q0.cost; acc.after += q1.cost;
  acc.xBefore += q0.counts.arrowArrow; acc.xAfter += q1.counts.arrowArrow;
  acc.sBefore += s0; acc.sAfter += s1;
  acc.swaps += res.swaps; acc.tried += res.tried; acc.n++;
}
console.log(`\n| показатель | до перебора | после |`);
console.log(`|---|---|---|`);
console.log(`| средний cost | ${Math.round((acc.before / acc.n) * 10) / 10} | ${Math.round((acc.after / acc.n) * 10) / 10} |`);
console.log(`| пересечений всего | ${acc.xBefore} | ${acc.xAfter} |`);
console.log(`| из них у стрелок с общим узлом | ${acc.sBefore} | ${acc.sAfter} |`);
console.log(`\nпринято обменов ${acc.swaps} из ${acc.tried} проверенных`);
