/** Where the whole corpus stands right now. */
import { arrangeGraph, boardQuality, computeArrowGeometries, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

export const settle = (artifacts: Artifact[], arrows: Arrow[]): Arrow[] | null => {
  const fresh = arrows.map((a) => ({ ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined } }));
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  let next = fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, autoPorts: true,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
  const s = searchPorts(artifacts, next);
  if (s.costAfter < s.costBefore) next = s.arrows;
  return next;
};

const main = () => {
  let cost = 0, cross = 0, turns = 0, corner = 0, straight = 0, seen = 0, n = 0;
  const scores: number[] = [];
  for (const item of loadCases().filter((c) => c.state.arrows.length > 0)) {
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const arrows = settle(placed.artifacts, placed.arrows);
    if (!arrows) continue;
    const q = boardQuality(placed.artifacts, arrows);
    cost += q.cost; cross += q.counts.arrowArrow; turns += q.metrics.drawnTurns;
    corner += q.metrics.cornerPorts; n += 1; scores.push(q.score);
    const geometries = computeArrowGeometries(placed.artifacts, arrows);
    for (const arrow of arrows) {
      const g = geometries.get(arrow.id);
      if (!g) continue;
      seen += 1;
      if (Math.abs(g.fromPoint.x - g.toPoint.x) < 1 || Math.abs(g.fromPoint.y - g.toPoint.y) < 1) straight += 1;
    }
  }
  scores.sort((a, b) => a - b);
  console.log(`досок ${n} · средний штраф ${Math.round((cost / n) * 10) / 10} · медиана балла ${scores[Math.floor(n / 2)]}`);
  console.log(`пересечений ${cross} · поворотов ${turns} · портов у края ${corner} · прямых ${straight} из ${seen}`);
  console.log(`на 100 баллов: ${scores.filter((x) => x === 100).length} досок, ниже 50: ${scores.filter((x) => x < 50).length}`);
};
main();
