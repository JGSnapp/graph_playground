/** Can ELK be made to keep our coordinates and only route the edges? */
import { createRequire } from 'node:module';
import { loadCases } from './offline.js';

const require = createRequire(import.meta.url);
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();

const item = loadCases().find((c) => c.name.includes('E08/wiki-anime'))!;
const { artifacts, arrows } = item.state;
const ids = new Set(artifacts.map((a) => a.id));
const edges = arrows
  .filter((a) => ids.has(a.from.artifactId) && ids.has(a.to.artifactId) && a.from.artifactId !== a.to.artifactId);

const attempts: Array<[string, Record<string, string>]> = [
  ['fixed', { 'elk.algorithm': 'org.eclipse.elk.fixed' }],
  ['fixed + ortho', { 'elk.algorithm': 'org.eclipse.elk.fixed', 'elk.edgeRouting': 'ORTHOGONAL' }],
  ['layered INTERACTIVE', {
    'elk.algorithm': 'layered',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
  }],
];

const main = async () => {
  for (const [name, layoutOptions] of attempts) {
    try {
      const laid: any = await elk.layout({
        id: 'root',
        layoutOptions,
        children: artifacts.map((a) => ({ id: a.id, x: a.x, y: a.y, width: a.width, height: a.height })),
        edges: edges.map((e) => ({ id: e.id, sources: [e.from.artifactId], targets: [e.to.artifactId] })),
      });
      const drift = Math.max(
        ...(laid.children ?? []).map((c: any) => {
          const o = artifacts.find((a) => a.id === c.id)!;
          return Math.max(Math.abs((c.x ?? o.x) - o.x), Math.abs((c.y ?? o.y) - o.y));
        }),
      );
      const withSections = (laid.edges ?? []).filter((e: any) => (e.sections ?? []).length > 0).length;
      const bends = (laid.edges ?? []).reduce(
        (n: number, e: any) => n + (e.sections ?? []).reduce((m: number, s: any) => m + (s.bendPoints?.length ?? 0), 0),
        0,
      );
      console.log(
        `${name.padEnd(22)} сдвиг узлов ${String(Math.round(drift)).padStart(5)}px | рёбер с трассой ${withSections}/${edges.length} | изгибов ${bends}`,
      );
    } catch (error) {
      console.log(`${name.padEnd(22)} ошибка: ${(error as Error).message.slice(0, 80)}`);
    }
  }
};

main();
