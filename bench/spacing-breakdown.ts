/** What the tighter, proportional spacing actually costs, by defect type. */
import { arrangeGraph, boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';

const OLD = { node: 80, layer: 220, group: 170 };
const acc: Record<string, [number, number]> = {};

for (const item of loadCases()) {
  const variants = [
    arrangeGraph(item.state.artifacts, item.state.arrows, { spacing: OLD }),
    arrangeGraph(item.state.artifacts, item.state.arrows),
  ];
  variants.forEach((r, index) => {
    const q = boardQuality(r.artifacts, r.arrows);
    for (const [key, value] of Object.entries(q.counts)) {
      if (!acc[key]) acc[key] = [0, 0];
      acc[key][index] += value as number;
    }
  });
}

const HARD = new Set(['artifactArtifact', 'arrowArtifact', 'arrowOverlap', 'arrowPortAngle', 'arrowSharedPort']);
console.log('нарушение'.padEnd(20), 'абсолютные', 'относительные', 'вес');
for (const [key, [a, b]] of Object.entries(acc)) {
  if (a === 0 && b === 0) continue;
  const mark = b > a ? ' ↑' : b < a ? ' ↓' : '';
  console.log(
    key.padEnd(20),
    String(a).padStart(10),
    (String(b) + mark).padStart(14),
    HARD.has(key) ? 'жёсткое' : 'косметика',
  );
}
