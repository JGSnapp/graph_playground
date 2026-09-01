/**
 * A/B: fixed spacing numbers against spacing derived from the node size.
 *
 * On the bench the gaps came out four to ten times the size of the blocks they
 * separated, because 220px between layers is sane for a 180px card and absurd
 * for a 60px chip.
 */
import { arrangeGraph, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

/**
 * Air around a block as a multiple of its own size: for every node the gap to
 * its nearest neighbour, divided by the node's smaller side. Counting every
 * pair that merely shares an axis inflates this with nodes layers apart.
 */
const gapRatio = (artifacts: Artifact[]): number => {
  if (artifacts.length < 2) return 0;
  const ratios: number[] = [];
  for (const a of artifacts) {
    let nearest = Infinity;
    for (const b of artifacts) {
      if (a === b) continue;
      const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
      const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    if (Number.isFinite(nearest)) ratios.push(nearest / Math.min(a.width, a.height));
  }
  ratios.sort((x, y) => x - y);
  return Math.round(ratios[ratios.length >> 1] * 10) / 10;
};

const aspectOf = (artifacts: Artifact[]): number => {
  const x1 = Math.min(...artifacts.map((a) => a.x));
  const y1 = Math.min(...artifacts.map((a) => a.y));
  const x2 = Math.max(...artifacts.map((a) => a.x + a.width));
  const y2 = Math.max(...artifacts.map((a) => a.y + a.height));
  return Math.round(((x2 - x1) / Math.max(1, y2 - y1)) * 100) / 100;
};

/** 1 is square; 5 means a 1:5 ribbon whichever way round. */
const stretch = (aspect: number): number => (aspect > 0 ? Math.max(aspect, 1 / aspect) : 0);

const OLD = { node: 80, layer: 220, group: 170 };
const acc = { oldCost: 0, newCost: 0, oldGap: 0, newGap: 0, oldStr: 0, newStr: 0, n: 0 };

console.log('случай'.padEnd(32), 'cost старое→новое', ' зазор/узел', 'вытянутость');
for (const item of loadCases()) {
  const before = arrangeGraph(item.state.artifacts, item.state.arrows, { spacing: OLD });
  const after = arrangeGraph(item.state.artifacts, item.state.arrows);
  const g0 = gapRatio(before.artifacts);
  const g1 = gapRatio(after.artifacts);
  const s0 = stretch(aspectOf(before.artifacts));
  const s1 = stretch(aspectOf(after.artifacts));
  console.log(
    item.name.slice(0, 32).padEnd(32),
    `${String(before.qualityAfter.cost).padStart(6)} → ${String(after.qualityAfter.cost).padEnd(6)}`,
    `${String(g0).padStart(5)} → ${String(g1).padEnd(5)}`,
    `${String(Math.round(s0 * 10) / 10).padStart(5)} → ${Math.round(s1 * 10) / 10}`,
  );
  acc.oldCost += before.qualityAfter.cost;
  acc.newCost += after.qualityAfter.cost;
  acc.oldGap += g0;
  acc.newGap += g1;
  acc.oldStr += s0;
  acc.newStr += s1;
  acc.n += 1;
}

const avg = (value: number): number => Math.round((value / acc.n) * 10) / 10;
console.log('\n| показатель | абсолютные отступы | относительные |');
console.log('|---|---|---|');
console.log(`| средний cost | ${avg(acc.oldCost)} | ${avg(acc.newCost)} |`);
console.log(`| зазор / размер блока | ${avg(acc.oldGap)} | ${avg(acc.newGap)} |`);
console.log(`| вытянутость (1 = квадрат) | ${avg(acc.oldStr)} | ${avg(acc.newStr)} |`);
