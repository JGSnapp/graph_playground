/**
 * How much air does an automatic layout actually need?
 *
 * The layout derives gaps from the median node and then lets `arrangeGraph`
 * try larger ones; nothing pulls the other way, because `boardQuality` has no
 * notion of compactness — air only ever removes penalties. Measured here
 * against the thing the metric cannot see: the area the composition eats.
 */
import { SPACING_RATIO, arrangeGraph, boardQuality, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const area = (artifacts: Artifact[]): number => {
  if (artifacts.length === 0) return 0;
  const left = Math.min(...artifacts.map((a) => a.x));
  const right = Math.max(...artifacts.map((a) => a.x + a.width));
  const top = Math.min(...artifacts.map((a) => a.y));
  const bottom = Math.max(...artifacts.map((a) => a.y + a.height));
  return ((right - left) * (bottom - top)) / 1e6;
};

const boards = loadCases().filter((c) => c.state.arrows.length > 0).slice(0, 45);
const base = { ...SPACING_RATIO };

const configs: Array<{ name: string; ratio: Partial<typeof SPACING_RATIO>; steps: number[] }> = [
  { name: 'как сейчас (1.15 / 0.55, шаги 1–1.9)', ratio: {}, steps: [1, 1.4, 1.9] },
  { name: 'те же доли, шаги 0.7–1.3', ratio: {}, steps: [0.7, 0.85, 1, 1.3] },
  { name: 'слои 0.85, шаги 0.7–1.3', ratio: { layer: 0.85 }, steps: [0.7, 0.85, 1, 1.3] },
  { name: 'слои 0.7, узлы 0.4, шаги 0.7–1.3', ratio: { layer: 0.7, node: 0.4 }, steps: [0.7, 0.85, 1, 1.3] },
  { name: 'слои 0.55, узлы 0.35, шаги 0.6–1', ratio: { layer: 0.55, node: 0.35 }, steps: [0.6, 0.8, 1] },
];

console.log('| настройка | средний штраф | пересечений | средняя площадь, млн px² |');
console.log('|---|---|---|---|');
for (const cfg of configs) {
  Object.assign(SPACING_RATIO, base, cfg.ratio);
  let cost = 0;
  let cross = 0;
  let space = 0;
  let n = 0;
  for (const item of boards) {
    const out = arrangeGraph(item.state.artifacts, item.state.arrows, { spacingSteps: cfg.steps });
    const q = boardQuality(out.artifacts, out.arrows);
    cost += q.cost;
    cross += q.counts.arrowArrow;
    space += area(out.artifacts);
    n += 1;
  }
  console.log(
    `| ${cfg.name} | ${(cost / n).toFixed(1)} | ${cross} | ${(space / n).toFixed(2)} |`,
  );
}
Object.assign(SPACING_RATIO, base);
