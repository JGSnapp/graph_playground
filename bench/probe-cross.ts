/** Why is the crossing on this board not removed by moving a port? */
import { boardQuality, checkIntersections, computeArrowGeometries, routeArrows, searchPorts, tooTightToRoute, type Arrow } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const artifacts = d.state.artifacts;
const arrows: Arrow[] = d.state.arrows;
const byId = new Map(artifacts.map((a: { id: string }) => [a.id, a]));
const name = (id: string) =>
  String((byId.get(id) as { props?: { text?: string } })?.props?.text ?? id).split('\n')[0].replace(/#/g, '').trim().slice(0, 16);

const base = boardQuality(artifacts, arrows);
console.log(`сейчас: ${base.score}/100, штраф ${base.cost}, пересечений ${base.counts.arrowArrow}`);
for (const f of checkIntersections(artifacts, arrows).findings) {
  if (f.kind !== 'arrow_arrow') continue;
  console.log(`  ${name(arrows.find((a) => a.id === f.arrowAId)!.from.artifactId)}→… × ${name(arrows.find((a) => a.id === f.arrowBId)!.from.artifactId)}→… в (${f.point.x},${f.point.y}), ${f.angle}°`);
}

// What the port search makes of it, given a free hand.
const searched = searchPorts(artifacts, arrows);
console.log(`\nперебор портов: ${searched.costBefore} → ${searched.costAfter} (ходов ${searched.swaps + searched.moves + searched.nudges}, проб ${searched.tried})`);

// And what the user proposes: the same arrow leaving further along the bottom.
const target = arrows.find((a) => a.from.side === 'bottom' && name(a.to.artifactId).includes('Отказ'));
if (!target) {
  console.log('не нашёл стрелку Скоринг→Отказ');
} else {
  console.log(`\nпробую сдвинуть крепление ${target.id} вдоль нижней стороны:`);
  for (const offset of [0.05, 0.15, 0.3, 0.5, 0.7, 0.9]) {
    const moved = arrows.map((a) =>
      a.id === target.id
        ? { ...a, bends: [], autoPorts: false, from: { ...a.from, offset } }
        : a,
    );
    if (!tooTightToRoute(artifacts, moved, [target.id]).ready) {
      console.log(`  off ${offset}: роутер отказался`);
      continue;
    }
    const out = routeArrows(artifacts, moved, { arrowIds: [target.id] });
    if (out.refused) { console.log(`  off ${offset}: отказ`); continue; }
    const next = moved.map((a) => {
      const r = out.routed.find((x) => x.arrowId === a.id);
      return r ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
    });
    const q = boardQuality(artifacts, next);
    const g = computeArrowGeometries(artifacts, next).get(target.id)!;
    console.log(`  off ${offset}: ${q.score}/100, пересечений ${q.counts.arrowArrow}, путь ${g.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
  }
}
