/** The hard cases, before and after the port search. */
import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';

const want = (process.argv[2] ?? 'dense-arch,extend-existing,blbe2739z6,6iwhu2896m').split(',');
for (const item of loadCases()) {
  if (!want.some((w) => item.name.includes(w))) continue;
  const off = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
  const on = arrangeGraph(item.state.artifacts, item.state.arrows);
  const qOff = boardQuality(off.artifacts, off.arrows);
  const qOn = boardQuality(on.artifacts, on.arrows);
  console.log(
    item.name.slice(0, 34).padEnd(34),
    `score ${String(qOff.score).padStart(3)} → ${String(qOn.score).padEnd(3)}`,
    `| пересечений ${String(qOff.counts.arrowArrow).padStart(2)} → ${qOn.counts.arrowArrow}`,
  );
}
