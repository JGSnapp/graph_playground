/** Does the stored polyline actually render as a connected orthogonal path? */
import { arrangeGraph, computeArrowGeometries, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadAvoid, routeAtPorts } from './libavoid.js';
import { loadCases } from './offline.js';

const ours = (artifacts: Artifact[], arrows: Arrow[]): Arrow[] | null => {
  const fresh = arrows.map((a) => ({ ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined } }));
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  return fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, autoPorts: true,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
};

/** A drawn path is sane when every run is axis aligned and nothing is degenerate. */
const inspect = (artifacts: Artifact[], arrows: Arrow[]) => {
  const geometries = computeArrowGeometries(artifacts, arrows);
  let diagonal = 0;
  let stored = 0;
  let drawn = 0;
  let mismatched = 0;
  for (const arrow of arrows) {
    const g = geometries.get(arrow.id);
    if (!g) continue;
    stored += arrow.bends.length;
    drawn += g.points.length;
    for (let i = 1; i < g.points.length; i++) {
      const a = g.points[i - 1];
      const b = g.points[i];
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) diagonal += 1;
    }
    // Does the drawn polyline still pass through the bends we stored?
    for (const bend of arrow.bends) {
      const hit = g.points.some((p) => Math.abs(p.x - bend.x) < 1.5 && Math.abs(p.y - bend.y) < 1.5);
      if (!hit) mismatched += 1;
    }
  }
  return { diagonal, stored, drawn, mismatched };
};

const main = async () => {
  const Avoid = await loadAvoid();
  const totals = { ours: { diagonal: 0, mismatched: 0, stored: 0 }, hybrid: { diagonal: 0, mismatched: 0, stored: 0 } };
  let n = 0;
  for (const item of loadCases()) {
    if (item.state.arrows.length === 0) continue;
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const base = ours(placed.artifacts, placed.arrows);
    if (!base) continue;
    let hybrid: Arrow[] | null = null;
    try {
      const start = routeAtPorts(Avoid, placed.artifacts, base) ?? base;
      const searched = searchPorts(placed.artifacts, start, {
        relay: (a, list, ids) => routeAtPorts(Avoid, a, list, ids),
      });
      hybrid = searched.costAfter < searched.costBefore ? searched.arrows : start;
    } catch { continue; }
    if (!hybrid) continue;

    const a = inspect(placed.artifacts, base);
    const b = inspect(placed.artifacts, hybrid);
    totals.ours.diagonal += a.diagonal; totals.ours.mismatched += a.mismatched; totals.ours.stored += a.stored;
    totals.hybrid.diagonal += b.diagonal; totals.hybrid.mismatched += b.mismatched; totals.hybrid.stored += b.stored;
    n += 1;
  }
  console.log(`досок: ${n}`);
  console.log('| вариант | диагональных отрезков | сохранённых изгибов | потеряно при отрисовке |');
  console.log('|---|---|---|---|');
  for (const [name, t] of [['наш роутер', totals.ours], ['libavoid + перебор', totals.hybrid]] as const) {
    console.log(`| ${name} | ${t.diagonal} | ${t.stored} | ${t.mismatched} |`);
  }
};
main();
