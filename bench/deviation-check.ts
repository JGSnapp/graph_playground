/**
 * How far does the drawn polyline stray from the route that was computed?
 *
 * Counting vanished vertices was the wrong test: a collinear point removed by
 * tidying still lies on the drawn line. What matters is distance between the
 * two paths, and whether the drawn one starts and ends where the route did.
 */
import { arrangeGraph, computeArrowGeometries, routeArrows, tooTightToRoute, anchorPoint, type Arrow, type Artifact, type Vec2 } from '@teca/shared';
import { loadAvoid, routeAtPorts, setBufferDistance } from './libavoid.js';
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

const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const distToPath = (p: Vec2, path: Vec2[]): number => {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(p, path[i - 1], path[i]));
  return best;
};

const main = async () => {
  const Avoid = await loadAvoid();
  setBufferDistance(72);
  let worst = 0;
  let strayed = 0;
  let total = 0;
  const examples: string[] = [];

  for (const item of loadCases().filter((c) => c.state.arrows.length > 0).slice(0, 30)) {
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const base = ours(placed.artifacts, placed.arrows);
    if (!base) continue;
    let routed: Arrow[] | null = null;
    try { routed = routeAtPorts(Avoid, placed.artifacts, base); } catch { continue; }
    if (!routed) continue;

    const byId = new Map(placed.artifacts.map((a) => [a.id, a]));
    const geometries = computeArrowGeometries(placed.artifacts, routed);
    for (const arrow of routed) {
      const drawn = geometries.get(arrow.id)?.points;
      if (!drawn || arrow.bends.length === 0) continue;
      const from = byId.get(arrow.from.artifactId)!;
      const to = byId.get(arrow.to.artifactId)!;
      const intended = [
        anchorPoint(from, arrow.from.side === 'auto' ? 'right' : arrow.from.side, arrow.from.offset ?? 0.5),
        ...arrow.bends,
        anchorPoint(to, arrow.to.side === 'auto' ? 'left' : arrow.to.side, arrow.to.offset ?? 0.5),
      ];
      // Furthest any intended vertex sits from the line that is actually drawn.
      const away = Math.max(...intended.map((p) => distToPath(p, drawn)));
      total += 1;
      if (away > 12) {
        strayed += 1;
        if (examples.length < 4) {
          examples.push(`${item.name.slice(0, 26)} ${arrow.id}: отклонение ${Math.round(away)}px`);
        }
      }
      worst = Math.max(worst, away);
    }
  }

  console.log(`стрелок проверено: ${total}`);
  console.log(`ушли от рассчитанной трассы дальше 12px: ${strayed} (${Math.round((strayed / total) * 100)}%)`);
  console.log(`худшее отклонение: ${Math.round(worst)}px`);
  for (const line of examples) console.log('  ' + line);
};
main();
