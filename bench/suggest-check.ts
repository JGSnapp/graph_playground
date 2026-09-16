/** Does the move suggestion find a real fix on the board the user pointed at? */
import { suggestMoves } from '@teca/shared';
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byId = new Map(d.state.artifacts.map((a: { id: string }) => [a.id, a]));
const name = (id: string) =>
  String((byId.get(id) as { props?: { text?: string } })?.props?.text ?? id)
    .split('\n')[0].replace(/#/g, '').trim().slice(0, 18);

const started = Date.now();
const moves = suggestMoves(d.state.artifacts, d.state.arrows);
console.log(`предложений: ${moves.length}, за ${Date.now() - started}мс`);
for (const m of moves) {
  console.log(`  ${name(m.artifactId)} → (${m.x}, ${m.y}): пересечений ${m.crossingsBefore} → ${m.crossingsAfter}, штраф ${m.costBefore} → ${m.costAfter}`);
}
