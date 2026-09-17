/** The route a person would draw, scored by the metric, next to what we produced. */
import { boardQuality, checkIntersections, computeArrowGeometries, type Arrow } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('bench/out/CHOICE/fix-broken__deepseek-v4-flash.json', 'utf8'));
const artifacts = d.state.artifacts;
const arrows: Arrow[] = d.state.arrows;
const byId = new Map(artifacts.map((a: { id: string }) => [a.id, a]));
const name = (id: string) =>
  String((byId.get(id) as { props?: { text?: string } })?.props?.text ?? id)
    .split('\n')[0].replace(/#/g, '').trim().slice(0, 16);

const show = (label: string, list: Arrow[]) => {
  const q = boardQuality(artifacts, list);
  console.log(`\n${label}: ${q.score}/100, штраф ${q.cost}, пересечений ${q.counts.arrowArrow}`);
  for (const item of q.breakdown) if (item.cost > 0) console.log(`   ${item.reason}: ${item.count} → ${item.cost}`);
};

show('как есть', arrows);

// Скоринг(520,0,220x140) → Отказ(1040,200,220x140), обходя Ручную проверку снизу.
const target = arrows.find((a) => name(a.to.artifactId).includes('Отказ') && a.from.side === 'bottom')!;
const hand = arrows.map((a) =>
  a.id === target.id
    ? {
        ...a,
        autoPorts: false,
        from: { artifactId: a.from.artifactId, side: 'bottom' as const, offset: 0.18 },
        to: { artifactId: a.to.artifactId, side: 'bottom' as const, offset: 0.5 },
        bends: [
          { x: 560, y: 420 },
          { x: 1150, y: 420 },
        ],
      }
    : a,
);
show('обход снизу, как нарисовал бы человек', hand);
const g = computeArrowGeometries(artifacts, hand).get(target.id)!;
console.log(`   путь: ${g.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
for (const f of checkIntersections(artifacts, hand).findings) {
  if (f.kind === 'arrow_arrow') console.log(`   пересечение в (${f.point.x},${f.point.y})`);
}
