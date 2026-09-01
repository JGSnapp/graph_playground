/** Linear against squared stretch penalty, on the same saved boards. */
import { arrangeGraph, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const aspect = (a: Artifact[]): number => {
  const x1 = Math.min(...a.map((n) => n.x));
  const y1 = Math.min(...a.map((n) => n.y));
  const x2 = Math.max(...a.map((n) => n.x + n.width));
  const y2 = Math.max(...a.map((n) => n.y + n.height));
  return (x2 - x1) / Math.max(1, y2 - y1);
};
const stretch = (v: number) => (v > 0 ? Math.max(v, 1 / v) : 0);

let cost = 0, str = 0, n = 0;
for (const item of loadCases()) {
  const r = arrangeGraph(item.state.artifacts, item.state.arrows);
  cost += r.qualityAfter.cost;
  str += stretch(aspect(r.artifacts));
  n += 1;
}
console.log(`средний cost ${Math.round((cost / n) * 10) / 10} | вытянутость ${Math.round((str / n) * 10) / 10}`);
