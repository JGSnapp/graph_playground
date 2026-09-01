/**
 * Simulates the "arrange-first" workflow without an LLM:
 * take a real graph, throw the positions away, drop the nodes into a naive
 * grid, create every arrow with auto sides (running the real refusal gates),
 * then call arrangeGraph. Measures whether the gates block the workflow and
 * whether the layout recovers from an arbitrary start.
 */
import {
  arrangeGraph, boardQuality, collectIntendedPorts, findMixedPortConflict,
  inspectRawPortAngles, intendedPortOf, centerOf, type Arrow, type Artifact,
} from '@teca/shared';
import { loadCases } from './offline.js';

const gridPlace = (artifacts: Artifact[], cols = 4, gapX = 320, gapY = 240): Artifact[] =>
  artifacts.map((a, i) => ({ ...a, x: (i % cols) * gapX, y: Math.floor(i / cols) * gapY }));

/** Same checks arrow_create runs before it agrees to create an arrow. */
const gateRefusals = (artifacts: Artifact[], arrows: Arrow[]): number => {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const accepted: Arrow[] = [];
  let refused = 0;
  for (const arrow of arrows) {
    const from = byId.get(arrow.from.artifactId);
    const to = byId.get(arrow.to.artifactId);
    if (!from || !to) continue;
    const angles = inspectRawPortAngles(from, to, 'auto', 'auto', []);
    if (angles.shallow) { refused++; continue; }
    const ports = collectIntendedPorts(artifacts, accepted);
    const fromInt = intendedPortOf(from, 'auto', undefined, centerOf(to));
    const toInt = intendedPortOf(to, 'auto', undefined, centerOf(from));
    const hit =
      findMixedPortConflict(ports, { artifactId: from.id, end: 'from', point: fromInt.point }) ??
      findMixedPortConflict(ports, { artifactId: to.id, end: 'to', point: toInt.point });
    if (hit) { refused++; continue; }
    accepted.push({ ...arrow, from: { ...arrow.from, side: 'auto', offset: undefined }, to: { ...arrow.to, side: 'auto', offset: undefined } });
  }
  return refused;
};

let sumOrig = 0, sumNaive = 0, sumArranged = 0, n = 0, refusalTotal = 0;
console.log('случай'.padEnd(34), 'узл свз', 'исходный', '  наивный', ' +arrange', 'отказы гейтов');
for (const item of loadCases()) {
  const arrows: Arrow[] = item.state.arrows.map((a) => ({
    ...a, bends: [], from: { ...a.from, side: 'auto', offset: undefined }, to: { ...a.to, side: 'auto', offset: undefined },
  }));
  const naive = gridPlace(item.state.artifacts);
  const refusals = gateRefusals(naive, arrows);
  const orig = boardQuality(item.state.artifacts, item.state.arrows);
  const naiveQ = boardQuality(naive, arrows);
  const arranged = arrangeGraph(naive, arrows);
  console.log(item.name.slice(0, 34).padEnd(34),
    String(naive.length).padStart(3), String(arrows.length).padStart(3),
    String(orig.cost).padStart(8), String(naiveQ.cost).padStart(9),
    String(arranged.qualityAfter.cost).padStart(9),
    String(refusals).padStart(13));
  sumOrig += orig.cost; sumNaive += naiveQ.cost; sumArranged += arranged.qualityAfter.cost; n++;
  refusalTotal += refusals;
}
console.log(`\nсредний cost: исходный=${Math.round(sumOrig / n)} наивная сетка=${Math.round(sumNaive / n)} наивная+arrange=${Math.round(sumArranged / n)}`);
console.log(`отказов гейтов на наивной расстановке: ${refusalTotal}`);
