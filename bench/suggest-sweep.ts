/** How often does a single-block move actually fix a crossing, across the corpus? */
import { boardQuality, suggestMoves } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let boards = 0;
let withCrossings = 0;
let helped = 0;
let ms = 0;
const examples: string[] = [];

const out = path.join(here, 'out');
for (const exp of fs.readdirSync(out).filter((d) => /^(E\d+|V\d+|AUTO|MANUAL|CHOICE)$/.test(d))) {
  for (const file of fs.readdirSync(path.join(out, exp)).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(out, exp, file), 'utf8'));
    if (!d.state?.arrows?.length) continue;
    boards += 1;
    const q = boardQuality(d.state.artifacts, d.state.arrows);
    if (q.counts.arrowArrow === 0) continue;
    withCrossings += 1;
    const started = Date.now();
    const moves = suggestMoves(d.state.artifacts, d.state.arrows);
    ms += Date.now() - started;
    if (moves.length > 0) {
      helped += 1;
      if (examples.length < 5) {
        examples.push(`  ${exp}/${d.task}: ${moves[0].note}`);
      }
    }
  }
}
console.log(`досок ${boards}, с пересечениями ${withCrossings}`);
console.log(`нашлась подсказка: ${helped} (${Math.round((helped / Math.max(withCrossings, 1)) * 100)}%)`);
console.log(`среднее время поиска: ${Math.round(ms / Math.max(withCrossings, 1))}мс`);
for (const e of examples) console.log(e);
