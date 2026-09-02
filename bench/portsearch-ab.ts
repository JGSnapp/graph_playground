/** arrangeGraph with and without the port-attachment search. */
import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';

const acc = { off: 0, on: 0, xOff: 0, xOn: 0, tOff: 0, tOn: 0, n: 0, better: 0 };
console.log('случай'.padEnd(30), 'без перебора', 'с перебором', 'пересечений');
for (const item of loadCases()) {
  const t0 = Date.now();
  const off = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
  const tOff = Date.now() - t0;
  const t1 = Date.now();
  const on = arrangeGraph(item.state.artifacts, item.state.arrows);
  const tOn = Date.now() - t1;

  const qOff = boardQuality(off.artifacts, off.arrows);
  const qOn = boardQuality(on.artifacts, on.arrows);
  console.log(
    item.name.slice(0, 30).padEnd(30),
    String(qOff.cost).padStart(12),
    String(qOn.cost).padStart(11),
    `${qOff.counts.arrowArrow} → ${qOn.counts.arrowArrow}`.padStart(12),
  );
  acc.off += qOff.cost; acc.on += qOn.cost;
  acc.xOff += qOff.counts.arrowArrow; acc.xOn += qOn.counts.arrowArrow;
  acc.tOff += tOff; acc.tOn += tOn; acc.n++;
  if (qOn.cost < qOff.cost) acc.better++;
}
const r = (v: number) => Math.round((v / acc.n) * 10) / 10;
console.log('\n| показатель | без перебора | с перебором |');
console.log('|---|---|---|');
console.log(`| средний cost | ${r(acc.off)} | ${r(acc.on)} |`);
console.log(`| пересечений всего | ${acc.xOff} | ${acc.xOn} |`);
console.log(`| секунд на доску | ${Math.round(acc.tOff / acc.n / 100) / 10} | ${Math.round(acc.tOn / acc.n / 100) / 10} |`);
console.log(`\nлучше с перебором: ${acc.better} из ${acc.n}`);
