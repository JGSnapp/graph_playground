/** Which penalties actually separate the two placement policies? */
import { boardQuality } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const totals = (exp: string) => {
  const acc = new Map<string, { count: number; cost: number }>();
  const dir = path.join(here, 'out', exp);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const item of boardQuality(d.state.artifacts, d.state.arrows).breakdown) {
      const cur = acc.get(item.reason) ?? { count: 0, cost: 0 };
      cur.count += item.count;
      cur.cost += item.cost;
      acc.set(item.reason, cur);
    }
  }
  return acc;
};

const a = totals('AUTO');
const m = totals('MANUAL');
console.log('| статья штрафа | авто (шт / штраф) | вручную (шт / штраф) |');
console.log('|---|---|---|');
const rows = [...new Set([...a.keys(), ...m.keys()])]
  .map((r) => ({ r, a: a.get(r) ?? { count: 0, cost: 0 }, m: m.get(r) ?? { count: 0, cost: 0 } }))
  .filter((x) => x.a.cost > 0 || x.m.cost > 0)
  .sort((x, y) => y.m.cost - y.a.cost - (x.m.cost - x.a.cost));
for (const x of rows) {
  console.log(`| ${x.r} | ${x.a.count} / ${Math.round(x.a.cost)} | ${x.m.count} / ${Math.round(x.m.cost)} |`);
}
const sum = (acc: Map<string, { cost: number }>) =>
  Math.round([...acc.values()].reduce((s, v) => s + v.cost, 0));
console.log(`| **итого штрафа** | **${sum(a)}** | **${sum(m)}** |`);
