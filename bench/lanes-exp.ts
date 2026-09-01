/** A/B: does pinning multi-layer edges to reserved lanes help? */
import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';

let a = 0, b = 0, n = 0, betterWith = 0;
console.log('случай'.padEnd(34), 'как есть', 'без дорожек', 'с дорожками', 'cross');
for (const item of loadCases()) {
  const now = boardQuality(item.state.artifacts, item.state.arrows).cost;
  const off = arrangeGraph(item.state.artifacts, item.state.arrows, { useLanes: false });
  const on = arrangeGraph(item.state.artifacts, item.state.arrows, { useLanes: true });
  console.log(item.name.slice(0, 34).padEnd(34),
    String(now).padStart(8), String(off.qualityAfter.cost).padStart(11),
    String(on.qualityAfter.cost).padStart(12),
    `${off.layout.crossings}/${on.layout.crossings}`.padStart(6));
  a += off.qualityAfter.cost; b += on.qualityAfter.cost; n++;
  if (on.qualityAfter.cost < off.qualityAfter.cost) betterWith++;
}
console.log(`\nсредний cost: без дорожек ${Math.round(a / n)} | с дорожками ${Math.round(b / n)} | с дорожками лучше в ${betterWith}/${n}`);
