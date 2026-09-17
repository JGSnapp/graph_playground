/** Board pictures for the README. */
import { boardQuality, type BoardState } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'docs', 'images');
fs.mkdirSync(out, { recursive: true });

const picks: Array<[string, string]> = [
  ['V4/tree-org', 'tree-org'],
  ['V4/extend-existing', 'extend-existing'],
  ['V3/tight-row', 'tight-row'],
  ['V1/wide-timeline', 'wide-timeline'],
  ['MANUAL/next-to-occupied', 'next-to-occupied'],
  ['V4/dense-arch', 'dense-arch'],
];

for (const [src, name] of picks) {
  const file = path.join(here, 'out', `${src}__deepseek-v4-flash.json`);
  if (!fs.existsSync(file)) { console.log(`нет ${src}`); continue; }
  const state = JSON.parse(fs.readFileSync(file, 'utf8')).state as BoardState;
  fs.writeFileSync(path.join(out, `${name}.png`), boardPng(state, 1200));
  const q = boardQuality(state.artifacts, state.arrows);
  console.log(`${name}: ${state.artifacts.length} блоков, ${state.arrows.length} стрелок, ${q.score}/100`);
}

// The router's own work, before and after the detour pass.
for (const [from, to] of [
  ['detour/CHOICE_fix-broken__deepseek-v4-flash__was.png', 'detour-was.png'],
  ['detour/CHOICE_fix-broken__deepseek-v4-flash__after.png', 'detour-after.png'],
]) {
  fs.copyFileSync(path.join(here, 'out', from), path.join(out, to));
}
// Curved mode.
fs.copyFileSync(path.join(here, 'out', 'curved', 'E12_tree-org-1.png'), path.join(out, 'curved.png'));
console.log(`→ ${out}`);
