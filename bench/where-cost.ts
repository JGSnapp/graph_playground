/** Where does the remaining penalty actually live? */
import { arrangeGraph, boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const routed = (artifacts: Artifact[], arrows: Arrow[]): Arrow[] | null => {
  const fresh = arrows.map((a) => ({ ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined } }));
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  return fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, autoPorts: true,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
};

const main = () => {
  const totals = new Map<string, { cost: number; count: number }>();
  let boards = 0;
  let sum = 0;
  const scores: number[] = [];

  for (const item of loadCases().filter((c) => c.state.arrows.length > 0)) {
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const base = routed(placed.artifacts, placed.arrows);
    if (!base) continue;
    const s = searchPorts(placed.artifacts, base);
    const arrows = s.costAfter < s.costBefore ? s.arrows : base;
    const q = boardQuality(placed.artifacts, arrows);
    boards += 1;
    sum += q.cost;
    scores.push(q.score);
    for (const item2 of q.breakdown) {
      const acc = totals.get(item2.reason) ?? { cost: 0, count: 0 };
      acc.cost += item2.cost;
      acc.count += item2.count;
      totals.set(item2.reason, acc);
    }
  }

  scores.sort((a, b) => a - b);
  const at = (p: number) => scores[Math.floor(scores.length * p)];
  console.log(`досок ${boards}, средний штраф ${Math.round((sum / boards) * 10) / 10}`);
  console.log(`балл: медиана ${at(0.5)}, четверть досок ниже ${at(0.25)}, четверть выше ${at(0.75)}`);
  console.log(`досок на 100 баллов: ${scores.filter((x) => x === 100).length}, ниже 50: ${scores.filter((x) => x < 50).length}`);
  console.log('\n| статья штрафа | доля | случаев |');
  console.log('|---|---|---|');
  for (const [reason, acc] of [...totals].sort((a, b) => b[1].cost - a[1].cost)) {
    if (acc.cost < 1) continue;
    console.log(`| ${reason} | ${Math.round((acc.cost / sum) * 100)}% | ${acc.count} |`);
  }
};
main();
