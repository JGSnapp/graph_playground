/**
 * `boardQuality` charges for bends the arrow *stores*. The reader sees the
 * bends that are *drawn*. Are those the same number?
 */
import { arrangeGraph, computeArrowGeometries, routeArrows, tooTightToRoute, type Arrow, type Artifact, type Vec2 } from '@teca/shared';
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

/** Direction changes on the polyline as drawn, ignoring zero-length steps. */
const drawnTurns = (points: Vec2[]): number => {
  const dirs: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
    if (dirs[dirs.length - 1] !== d) dirs.push(d);
  }
  return Math.max(0, dirs.length - 1);
};

const main = async () => {
  const Avoid = await loadAvoid();
  const acc = { ours: { stored: 0, drawn: 0, n: 0 }, hybrid: { stored: 0, drawn: 0, n: 0 } };

  for (const item of loadCases().filter((c) => c.state.arrows.length > 0)) {
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const base = ours(placed.artifacts, placed.arrows);
    if (!base) continue;
    let hybrid: Arrow[] | null = null;
    try { hybrid = routeAtPorts(Avoid, placed.artifacts, base); } catch { /* ignore */ }

    for (const [key, list] of [['ours', base], ['hybrid', hybrid]] as const) {
      if (!list) continue;
      const geometries = computeArrowGeometries(placed.artifacts, list);
      for (const arrow of list) {
        const g = geometries.get(arrow.id);
        if (!g) continue;
        acc[key].stored += arrow.bends.length;
        acc[key].drawn += drawnTurns(g.points);
        acc[key].n += 1;
      }
    }
  }

  console.log('| вариант | изгибов сохранено | изгибов нарисовано | стрелок | нарисовано/сохранено |');
  console.log('|---|---|---|---|---|');
  for (const [name, a] of [['наш роутер', acc.ours], ['libavoid при наших портах', acc.hybrid]] as const) {
    console.log(`| ${name} | ${a.stored} | ${a.drawn} | ${a.n} | ${(a.drawn / Math.max(a.stored, 1)).toFixed(2)} |`);
  }
};
main();
