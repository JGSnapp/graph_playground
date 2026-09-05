/** Redraws the PNGs of a finished experiment with today's geometry. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exp = process.argv[2] ?? 'E12';
const dir = path.join(here, 'out', exp);

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  if (!d.state) continue;
  fs.writeFileSync(path.join(dir, file.replace('.json', '.png')), boardPng(d.state));
  console.log('  ' + file.replace('.json', '.png'));
}
