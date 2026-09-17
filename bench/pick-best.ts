import { boardQuality } from '@teca/shared';
import { loadCases } from './offline.js';
const rows = [];
for (const item of loadCases()) {
  const { artifacts, arrows } = item.state;
  if (arrows.length < 4 || artifacts.length < 5) continue;
  const q = boardQuality(artifacts, arrows);
  rows.push({ name: item.name, score: q.score, n: artifacts.length, e: arrows.length, x: q.metrics.crossings });
}
rows.sort((a, b) => b.score - a.score || b.n - a.n);
for (const r of rows.slice(0, 28)) console.log(`${String(r.score).padStart(3)}  ${String(r.n).padStart(2)} бл  ${String(r.e).padStart(2)} стр  ${r.x} перес  ${r.name}`);
