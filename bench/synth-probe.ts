import { boardQuality, routeArrows, suggestMoves, type Arrow, type Artifact } from '@teca/shared';

const box = (id: string, x: number, y: number): Artifact => ({
  id, type: 'note', z: 0, props: {}, x, y, width: 220, height: 140, createdAt: 0, updatedAt: 0,
});
const pinned = (id: string, from: string, to: string): Arrow => ({
  id,
  from: { artifactId: from, side: 'right', offset: 0.5 },
  to: { artifactId: to, side: 'left', offset: 0.5 },
  bends: [], style: {}, createdAt: 0, updatedAt: 0,
});

const artifacts = [box('a', 0, 0), box('b', 400, 0), box('c', 0, 200), box('d', 400, 200)];
const arrows = [pinned('r1', 'a', 'd'), pinned('r2', 'c', 'b')];
const out = routeArrows(artifacts, arrows);
const routed = arrows.map((a) => {
  const r = out.routed.find((x) => x.arrowId === a.id);
  return r ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
});
const q = boardQuality(artifacts, routed);
console.log(`пересечений ${q.counts.arrowArrow}, штраф ${q.cost}, балл ${q.score}`);
const moves = suggestMoves(artifacts, routed);
console.log(`подсказок: ${moves.length}`);
for (const m of moves) console.log('  ' + m.note);
