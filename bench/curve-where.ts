/** Which penalty grows when the arrows are drawn round? */
import { boardQuality, type Arrow } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharpTotals = new Map<string, number>();
const curvedTotals = new Map<string, number>();

const add = (into: Map<string, number>, reason: string, value: number) =>
  into.set(reason, (into.get(reason) ?? 0) + value);

const out = path.join(here, 'out');
for (const exp of fs.readdirSync(out).filter((d) => /^(E\d+|V\d+)$/.test(d))) {
  for (const file of fs.readdirSync(path.join(out, exp)).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(out, exp, file), 'utf8'));
    if (!d.state?.arrows?.length) continue;
    for (const item of boardQuality(d.state.artifacts, d.state.arrows).breakdown) {
      add(sharpTotals, item.reason, item.count);
    }
    const curved: Arrow[] = d.state.arrows.map((a: Arrow) => ({ ...a, routing: 'curved' }));
    for (const item of boardQuality(d.state.artifacts, curved).breakdown) {
      add(curvedTotals, item.reason, item.count);
    }
  }
}

console.log('| статья | прямые углы | скруглённые | разница |');
console.log('|---|---|---|---|');
for (const reason of new Set([...sharpTotals.keys(), ...curvedTotals.keys()])) {
  const a = sharpTotals.get(reason) ?? 0;
  const b = curvedTotals.get(reason) ?? 0;
  if (a === 0 && b === 0) continue;
  const delta = b - a;
  console.log(`| ${reason} | ${a} | ${b} | ${delta === 0 ? '—' : (delta > 0 ? '+' : '') + delta} |`);
}
