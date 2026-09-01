/** Does pricing the "sidestep and come back" wobble remove it? */
import { boardQuality, routeArrows, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
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

/** Counts runs shorter than 64px that sit between two turns. */
const wobbles = (artifacts: Artifact[], arrows: Arrow[]): number => {
  let n = 0;
  for (const arrow of arrows) {
    const pts = [arrow.bends].flat();
    for (let i = 1; i < pts.length - 1; i++) {
      const run = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
      if (run < 64) n += 1;
    }
  }
  return n;
};

const PENALTIES = [0, 150, 400, 900];
const totals = PENALTIES.map(() => ({ cost: 0, wob: 0, bends: 0, n: 0 }));

for (const item of loadCases()) {
  if (!tooTightToRoute(item.state.artifacts, item.state.arrows).ready) continue;
  PENALTIES.forEach((p, i) => {
    const out = routeArrows(item.state.artifacts, item.state.arrows, { jogPenalty: p });
    const next = apply(item.state.arrows, out.routed);
    const q = boardQuality(item.state.artifacts, next);
    const t = totals[i];
    t.cost += q.cost;
    t.wob += wobbles(item.state.artifacts, next);
    t.bends += next.reduce((s, a) => s + a.bends.length, 0);
    t.n += 1;
  });
}

console.log('| штраф за ступеньку | средн. cost | ступенек | изгибов |');
console.log('|---|---|---|---|');
PENALTIES.forEach((p, i) => {
  const t = totals[i];
  console.log(`| ${p} | ${Math.round(t.cost / t.n)} | ${t.wob} | ${t.bends} |`);
});
