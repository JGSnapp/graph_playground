/** Port search A/B on a fixed subset, so the sweep finishes in a minute. */
import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';

const want = (process.argv[2] ?? 'E07/wiki-anime,E07/dense-arch,E07/tree-org,E07/extend-existing,brd_blbe,brd_cc95').split(',');
const acc = { off: 0, on: 0, xOff: 0, xOn: 0, tOn: 0, n: 0 };
console.log('случай'.padEnd(32), 'без перебора', 'с перебором', 'пересечений', 'сек');
for (const item of loadCases()) {
  if (!want.some((w) => item.name.includes(w))) continue;
  const off = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
  const t = Date.now();
  const on = arrangeGraph(item.state.artifacts, item.state.arrows);
  const secs = (Date.now() - t) / 1000;
  const qOff = boardQuality(off.artifacts, off.arrows);
  const qOn = boardQuality(on.artifacts, on.arrows);
  console.log(item.name.slice(0, 32).padEnd(32), String(qOff.cost).padStart(12),
    String(qOn.cost).padStart(11), `${qOff.counts.arrowArrow} → ${qOn.counts.arrowArrow}`.padStart(12),
    secs.toFixed(1).padStart(5));
  acc.off += qOff.cost; acc.on += qOn.cost;
  acc.xOff += qOff.counts.arrowArrow; acc.xOn += qOn.counts.arrowArrow;
  acc.tOn += secs; acc.n++;
}
const r = (v: number) => Math.round((v / acc.n) * 10) / 10;
console.log(`\nсредний cost ${r(acc.off)} → ${r(acc.on)} | пересечений ${acc.xOff} → ${acc.xOn} | ${r(acc.tOn)} с на доску`);
