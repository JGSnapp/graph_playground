/** What does each candidate move actually give on this board? */
import { boardQuality, routeArrows, tooTightToRoute, type Artifact } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const artifacts: Artifact[] = d.state.artifacts;
const arrows = d.state.arrows;
const byId = new Map(artifacts.map((a) => [a.id, a]));
const name = (id: string) =>
  String((byId.get(id) as { props?: { text?: string } })?.props?.text ?? id)
    .split('\n')[0].replace(/#/g, '').trim().slice(0, 16);

const before = boardQuality(artifacts, arrows);
console.log(`сейчас ${before.score}/100, штраф ${before.cost}, пересечений ${before.counts.arrowArrow}`);

const test = (id: string, x: number, y: number) => {
  const moved = artifacts.map((a) => (a.id === id ? { ...a, x, y } : a));
  const clash = moved.some(
    (a) => a.id !== id && x < a.x + a.width && a.x < x + byId.get(id)!.width &&
      y < a.y + a.height && a.y < y + byId.get(id)!.height,
  );
  if (clash) return `(${x},${y}) наложение`;
  const loose = arrows.map((a: { id: string }) => ({ ...a, bends: [] }));
  if (!tooTightToRoute(moved, loose).ready) return `(${x},${y}) роутер отказался`;
  const out = routeArrows(moved, loose);
  if (out.refused) return `(${x},${y}) отказ`;
  const next = loose.map((a: { id: string }) => {
    const r = out.routed.find((x2: { arrowId: string }) => x2.arrowId === a.id);
    return r ? { ...a, bends: r.bends, autoPorts: true,
      from: { ...(a as never as { from: object }).from, side: r.fromSide, offset: r.fromOffset },
      to: { ...(a as never as { to: object }).to, side: r.toSide, offset: r.toOffset } } : a;
  });
  const q = boardQuality(moved, next as never);
  return `(${x},${y}) ${q.score}/100, пересечений ${q.counts.arrowArrow}, штраф ${q.cost}`;
};

for (const a of artifacts) {
  const step = { x: a.width + 40, y: a.height + 40 };
  const tries = [
    [a.x, a.y + step.y], [a.x, a.y - step.y],
    [a.x + step.x, a.y], [a.x - step.x, a.y],
    [a.x, a.y + step.y * 2],
  ];
  const out = tries.map(([x, y]) => test(a.id, x, y)).filter((s) => !s.includes('наложение'));
  if (out.length) console.log(`${name(a.id)}: ${out.join(' | ')}`);
}
