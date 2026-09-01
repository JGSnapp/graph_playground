/** Renders every board from a data dir to PNG + prints its quality. Read-only. */
import { boardQuality } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe } from './metrics.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.argv[2] ?? path.resolve(here, '../data/boards.json');
const outDir = process.argv[3] ?? path.resolve(here, 'out/existing');
fs.mkdirSync(outDir, { recursive: true });

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
for (const record of data.boards) {
  const board = record.board;
  const { artifacts, arrows } = board.state;
  if (artifacts.length === 0) continue;
  const quality = boardQuality(artifacts, arrows);
  const obs = observe(board.state);
  const name = `${board.id}`;
  fs.writeFileSync(path.join(outDir, `${name}.png`), boardPng(board.state));
  console.log(
    `${name} | ${board.model} | score ${quality.score} (${quality.grade}) cost ${quality.cost} | ` +
      `${artifacts.length}узл ${arrows.length}свз | ${obs.width}x${obs.height} aspect ${obs.aspect} ` +
      `fidelity ${obs.neighbourFidelity} spread ${obs.edgeLengthSpread} | ` +
      Object.entries(quality.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' '),
  );
}
