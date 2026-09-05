/** How many ports sit within N px of a corner today? */
import { arrangeGraph, computeArrowGeometries, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const ours = (artifacts: Artifact[], arrows: Arrow[], withSearch: boolean): Arrow[] | null => {
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
  if (withSearch) {
    const s = searchPorts(artifacts, next);
    if (s.costAfter < s.costBefore) next = s.arrows;
  }
  return next;
};

const main = () => {
  const buckets = [4, 10, 17];
  for (const withSearch of [false, true]) {
    let ports = 0;
    const samples: string[] = [];
    const near = new Map(buckets.map((b) => [b, 0]));
    for (const item of loadCases()) {
      if (item.state.arrows.length === 0) continue;
      const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
      const routed = ours(placed.artifacts, placed.arrows, withSearch);
      if (!routed) continue;
      const byId = new Map(placed.artifacts.map((a) => [a.id, a]));
      const geometries = computeArrowGeometries(placed.artifacts, routed);
      for (const arrow of routed) {
        const g = geometries.get(arrow.id);
        if (!g) continue;
        for (const [side, offset, id] of [
          [g.fromSide, g.fromOffset, arrow.from.artifactId],
          [g.toSide, g.toOffset, arrow.to.artifactId],
        ] as const) {
          const box = byId.get(id);
          if (!box) continue;
          const len = side === 'top' || side === 'bottom' ? box.width : box.height;
          const fromCorner = Math.min(offset, 1 - offset) * len;
          ports += 1;
          for (const b of buckets) if (fromCorner < b) near.set(b, near.get(b)! + 1);
          if (fromCorner < 17 && samples.length < 12) {
            samples.push(`  ${Math.round(fromCorner)}px от угла: блок ${box.width}x${box.height}, сторона ${side}, off ${offset.toFixed(3)}, стрелка ${arrow.id}`);
          }
        }
      }
    }
    const label = withSearch ? 'после перебора портов' : 'сразу после роутера';
    const cells = buckets.map((b) => `<${b}px: ${near.get(b)} (${Math.round((near.get(b)! / ports) * 100)}%)`);
    console.log(`${label}: портов ${ports} · ${cells.join(' · ')}`);
    if (!withSearch) for (const line of samples) console.log(line);
  }
};
main();
