/**
 * Would ports assigned by the distribution pass beat ports the router pinned
 * one arrow at a time? Saved boards carry the router's pinned offsets, so the
 * comparison is: route them as they are, versus route them with the ports
 * released first.
 */
import { boardQuality, checkIntersections, routeArrows, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const apply = (list: Arrow[], routed: ReturnType<typeof routeArrows>['routed']): Arrow[] =>
  list.map((a) => {
    const m = routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, routing: 'orthogonal' as const,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });

const release = (list: Arrow[]): Arrow[] =>
  list.map((a) => ({
    ...a,
    from: { ...a.from, offset: undefined },
    to: { ...a.to, offset: undefined },
  }));

const run = (artifacts: Artifact[], arrows: Arrow[]) => {
  if (!tooTightToRoute(artifacts, arrows).ready) return null;
  const out = routeArrows(artifacts, arrows);
  const next = apply(arrows, out.routed);
  const q = boardQuality(artifacts, next);
  const report = checkIntersections(artifacts, next);
  const shared = report.findings.filter((f) => {
    if (f.kind !== 'arrow_arrow') return false;
    const a = arrows.find((x) => x.id === f.arrowAId)!;
    const b = arrows.find((x) => x.id === f.arrowBId)!;
    const ends = new Set([a.from.artifactId, a.to.artifactId]);
    return ends.has(b.from.artifactId) || ends.has(b.to.artifactId);
  }).length;
  return { cost: q.cost, cross: q.counts.arrowArrow, shared };
};

const acc = { pinCost: 0, freeCost: 0, pinX: 0, freeX: 0, pinS: 0, freeS: 0, n: 0 };
console.log('случай'.padEnd(30), 'приколотые порты', 'свободные порты');
for (const item of loadCases()) {
  const pinned = run(item.state.artifacts, item.state.arrows);
  const free = run(item.state.artifacts, release(item.state.arrows));
  if (!pinned || !free) continue;
  console.log(item.name.slice(0, 30).padEnd(30),
    `${String(Math.round(pinned.cost)).padStart(5)} / ${String(pinned.cross).padStart(2)}× (${pinned.shared} общих)`.padStart(24),
    `${String(Math.round(free.cost)).padStart(5)} / ${String(free.cross).padStart(2)}× (${free.shared} общих)`.padStart(24));
  acc.pinCost += pinned.cost; acc.freeCost += free.cost;
  acc.pinX += pinned.cross; acc.freeX += free.cross;
  acc.pinS += pinned.shared; acc.freeS += free.shared; acc.n++;
}
console.log(`\n| порты | средн. cost | пересечений | из них у общих узлов |`);
console.log(`|---|---|---|---|`);
console.log(`| приколотые роутером | ${Math.round(acc.pinCost / acc.n)} | ${acc.pinX} | ${acc.pinS} |`);
console.log(`| пересчитанные | ${Math.round(acc.freeCost / acc.n)} | ${acc.freeX} | ${acc.freeS} |`);
