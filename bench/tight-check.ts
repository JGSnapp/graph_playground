/** Given the board the agent ended up with, what would our own pipeline do? */
import { boardQuality, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import fs from 'node:fs';
import { settle } from './state.js';

const main = () => {
  const file = process.argv[2] ?? 'bench/out/E10/tight-row__deepseek-v4-flash.json';
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const artifacts: Artifact[] = d.state.artifacts;
  const arrows: Arrow[] = d.state.arrows;

  const asIs = boardQuality(artifacts, arrows);
  console.log(`как оставил агент: ${asIs.score}/100, штраф ${asIs.cost}`);
  for (const b of asIs.breakdown) if (b.cost > 0) console.log(`  ${b.reason}: ${b.count} → ${b.cost}`);

  const gate = tooTightToRoute(artifacts, arrows);
  console.log(`\nгейт: ready=${gate.ready}, тесных стрелок ${gate.crowded.length}, наложений ${gate.overlapping}`);

  const ours = settle(artifacts, arrows);
  if (!ours) {
    console.log('наш конвейер отказался');
    return;
  }
  const after = boardQuality(artifacts, ours);
  console.log(`\nнаш роутер + перебор портов: ${after.score}/100, штраф ${after.cost}`);
  for (const b of after.breakdown) if (b.cost > 0) console.log(`  ${b.reason}: ${b.count} → ${b.cost}`);

  // How tight is the row actually?
  const sorted = [...artifacts].sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const overlapY = prev.y < sorted[i].y + sorted[i].height && sorted[i].y < prev.y + prev.height;
    if (overlapY) gaps.push(sorted[i].x - (prev.x + prev.width));
  }
  console.log(`\nпросветы между соседями по горизонтали: ${gaps.map((g) => Math.round(g)).join(', ')}`);
};
main();
