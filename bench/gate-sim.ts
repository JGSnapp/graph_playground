/**
 * Runs the real arrow_create tool over a naive grid placement and counts how
 * many calls the gates refuse — the metric that drove the refusal loop.
 */
import { boardQuality, checkIntersections } from '@teca/shared';
import { ToolRegistry } from '../server/src/modules/agent/tools/index.js';
import { createArtifact } from '../server/src/modules/boards/operations.js';
import { createContext } from '../server/src/context.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCases } from './offline.js';

const registry = new ToolRegistry();
let refusals = 0, calls = 0, adjusted = 0, sumAfter = 0, n = 0;

console.log('случай'.padEnd(34), 'узл свз', 'отказов', 'починок', 'cost после arrange');
for (const item of loadCases()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teca-gate-'));
  const ctx = createContext({ dataDir: dir });
  const board = ctx.boards.create();
  const toolCtx = { boardId: board.id, boards: ctx.boards, knowledge: ctx.knowledge, skills: ctx.skills,
    settings: ctx.settings.get(), screenshots: ctx.screenshots, emit: () => undefined, signal: new AbortController().signal };

  const idMap = new Map<string, string>();
  ctx.boards.mutate(board.id, (state) => {
    item.state.artifacts.forEach((a, i) => {
      const made = createArtifact(state, { type: a.type, x: (i % 4) * 320, y: Math.floor(i / 4) * 240,
        width: a.width, height: a.height, props: a.props });
      idMap.set(a.id, made.id);
    });
    return null;
  });

  let localRefusals = 0, localAdjusted = 0;
  for (const arrow of item.state.arrows) {
    const fromId = idMap.get(arrow.from.artifactId);
    const toId = idMap.get(arrow.to.artifactId);
    if (!fromId || !toId) continue;
    calls++;
    const res = await registry.get('arrow_create')!.run({ fromId, toId, label: arrow.label }, toolCtx);
    const data = res.data as Record<string, unknown>;
    if (data.refused) { refusals++; localRefusals++; }
    else if (Array.isArray(data.adjustments)) { adjusted++; localAdjusted++; }
  }

  const arranged = await registry.get('board_arrange_graph')!.run({}, toolCtx);
  const after = ctx.boards.read(board.id, (s) => boardQuality(s.artifacts, s.arrows));
  console.log(item.name.slice(0, 34).padEnd(34),
    String(item.state.artifacts.length).padStart(3), String(item.state.arrows.length).padStart(3),
    String(localRefusals).padStart(7), String(localAdjusted).padStart(7),
    String(after.cost).padStart(18));
  sumAfter += after.cost; n++;
  await ctx.flush();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\nвызовов arrow_create: ${calls}, отказов: ${refusals}, автопочинок: ${adjusted}`);
console.log(`средний cost после board_arrange_graph: ${Math.round(sumAfter / n)}`);
