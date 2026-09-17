/** Is the missing piece the side the arrow arrives on? */
import { boardQuality, computeArrowGeometries, routeArrows, tooTightToRoute, type Arrow, type AnchorSide } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('bench/out/CHOICE/fix-broken__deepseek-v4-flash.json', 'utf8'));
const artifacts = d.state.artifacts;
const arrows: Arrow[] = d.state.arrows;
const id = 'arr_8j5u75rak9';

const sides: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
console.log(`сейчас ${boardQuality(artifacts, arrows).score}/100`);
for (const from of sides) {
  for (const to of sides) {
    for (const price of [200, 1200]) {
      const loose = arrows.map((a) =>
        a.id === id
          ? { ...a, bends: [], autoPorts: false,
              from: { ...a.from, side: from, offset: undefined },
              to: { ...a.to, side: to, offset: undefined } }
          : a,
      );
      if (!tooTightToRoute(artifacts, loose, [id]).ready) continue;
      const out = routeArrows(artifacts, loose, { arrowIds: [id], crossPenalty: price });
      if (out.refused) continue;
      const next = loose.map((a) => {
        const r = out.routed.find((x) => x.arrowId === a.id);
        return r ? { ...a, bends: r.bends,
          from: { ...a.from, side: r.fromSide, offset: r.fromOffset },
          to: { ...a.to, side: r.toSide, offset: r.toOffset } } : a;
      });
      const q = boardQuality(artifacts, next);

      const g = computeArrowGeometries(artifacts, next).get(id)!;
      console.log(`  ${from}→${to}, цена ${price}: ${q.score}/100, пересечений ${q.counts.arrowArrow}`);
      console.log(`     ${g.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
    }
  }
}
