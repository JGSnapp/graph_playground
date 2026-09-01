import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';
import { observe } from './metrics.js';

let a = { cost: 0, sep: 0, over: 0, aspect: 0 };
let b = { cost: 0, sep: 0, over: 0, aspect: 0 };
let n = 0;
console.log('случай'.padEnd(34), '  cost до  cost после   раздел до/после  текст не влез  aspect до/после');
for (const item of loadCases()) {
  const before = observe(item.state);
  const q0 = boardQuality(item.state.artifacts, item.state.arrows);
  const r = arrangeGraph(item.state.artifacts, item.state.arrows);
  const after = observe({ artifacts: r.artifacts, arrows: r.arrows });
  console.log(item.name.slice(0, 34).padEnd(34),
    String(q0.cost).padStart(8), String(r.qualityAfter.cost).padStart(10),
    `${String(before.separation).padStart(9)} → ${String(after.separation).padEnd(5)}`,
    `${String(before.textOverflow).padStart(9)} → ${String(after.textOverflow).padEnd(4)}`,
    `${String(before.aspect).padStart(6)} → ${after.aspect}`);
  a.cost += q0.cost; a.sep += before.separation; a.over += before.textOverflow; a.aspect += before.aspect;
  b.cost += r.qualityAfter.cost; b.sep += after.separation; b.over += after.textOverflow; b.aspect += after.aspect;
  n++;
}
const r2 = (x: number) => Math.round((x / n) * 100) / 100;
console.log(`\n| показатель | до | после |`);
console.log(`|---|---|---|`);
console.log(`| средний cost | ${r2(a.cost)} | ${r2(b.cost)} |`);
console.log(`| separation (связанное ближе чужого) | ${r2(a.sep)} | ${r2(b.sep)} |`);
console.log(`| узлов с непомещающимся текстом | ${r2(a.over)} | ${r2(b.over)} |`);
console.log(`| aspect | ${r2(a.aspect)} | ${r2(b.aspect)} |`);
