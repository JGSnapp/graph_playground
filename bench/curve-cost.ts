/**
 * With the metric reading the drawn arc, what does the curved mode cost?
 *
 * The same boards, scored twice: once as the orthogonal route they were laid
 * out as, once with every arrow marked curved. The detector is the real one, so
 * shared ports and along-running pairs are handled as they always were.
 */
import { boardQuality, type Arrow } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const main = () => {
  let sharpCross = 0;
  let curvedCross = 0;
  let sharpCost = 0;
  let curvedCost = 0;
  let boards = 0;
  let worse = 0;
  let better = 0;
  const examples: string[] = [];

  const out = path.join(here, 'out');
  for (const exp of fs.readdirSync(out).filter((d) => /^(E\d+|V\d+)$/.test(d))) {
    for (const file of fs.readdirSync(path.join(out, exp)).filter((f) => f.endsWith('.json'))) {
      const d = JSON.parse(fs.readFileSync(path.join(out, exp, file), 'utf8'));
      if (!d.state?.arrows?.length) continue;
      boards += 1;
      const sharp = boardQuality(d.state.artifacts, d.state.arrows);
      const curvedArrows: Arrow[] = d.state.arrows.map((a: Arrow) => ({ ...a, routing: 'curved' }));
      const curved = boardQuality(d.state.artifacts, curvedArrows);

      sharpCross += sharp.counts.arrowArrow;
      curvedCross += curved.counts.arrowArrow;
      sharpCost += sharp.cost;
      curvedCost += curved.cost;
      if (curved.cost > sharp.cost + 0.5) {
        worse += 1;
        if (examples.length < 5) {
          examples.push(
            `  ${exp}/${d.task}: ${sharp.score} → ${curved.score}, пересечений ${sharp.counts.arrowArrow} → ${curved.counts.arrowArrow}`,
          );
        }
      } else if (curved.cost < sharp.cost - 0.5) better += 1;
    }
  }

  console.log(`досок ${boards}`);
  console.log(`пересечений: прямые углы ${sharpCross}, скруглённые ${curvedCross}`);
  console.log(`средний штраф: ${Math.round((sharpCost / boards) * 10) / 10} → ${Math.round((curvedCost / boards) * 10) / 10}`);
  console.log(`досок хуже ${worse}, лучше ${better}, без изменений ${boards - worse - better}`);
  for (const line of examples) console.log(line);
};
main();
