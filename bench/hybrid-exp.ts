/**
 * The hybrid: libavoid draws the lines, our port search decides where they
 * attach. Measured against each half on its own, on our own node placement.
 */
import {
  arrangeGraph,
  boardQuality,
  routeArrows,
  searchPorts,
  tooTightToRoute,
  type Arrow,
  type Artifact,
} from '@teca/shared';
import { loadAvoid, routeAtPorts, routeFree } from './libavoid.js';
import { loadCases } from './offline.js';

const released = (arrows: Arrow[]): Arrow[] =>
  arrows.map((a) => ({
    ...a,
    bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));

/** Our router, optionally followed by the port search. */
const ours = (artifacts: Artifact[], arrows: Arrow[], withSearch: boolean): Arrow[] | null => {
  const fresh = released(arrows);
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  let next = fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? {
          ...a, bends: m.bends, autoPorts: true,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset },
        }
      : a;
  });
  if (withSearch) {
    const searched = searchPorts(artifacts, next);
    if (searched.costAfter < searched.costBefore) next = searched.arrows;
  }
  return next;
};

const stats = () => ({ cost: 0, cross: 0, bends: 0, ms: 0, n: 0 });

const main = async () => {
  const Avoid = await loadAvoid();
  const acc = {
    oursPlain: stats(),
    oursSearch: stats(),
    avoidFree: stats(),
    hybrid: stats(),
  };

  for (const item of loadCases()) {
    if (item.state.arrows.length === 0) continue;
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const { artifacts } = placed;
    const arrows = placed.arrows;

    const timed = <T>(run: () => T): [T, number] => {
      const started = Date.now();
      const value = run();
      return [value, Date.now() - started];
    };

    const [plain, tPlain] = timed(() => ours(artifacts, arrows, false));
    const [search, tSearch] = timed(() => ours(artifacts, arrows, true));
    if (!plain || !search) continue;

    let free: Arrow[] | null = null;
    let hybrid: Arrow[] | null = null;
    let tFree = 0;
    let tHybrid = 0;
    try {
      [free, tFree] = timed(() => routeFree(Avoid, artifacts, arrows));
      // The hybrid starts from our routed board — so the ports are real sides,
      // not `auto` — and then lets the search move them, with libavoid drawing.
      [hybrid, tHybrid] = timed(() => {
        const start = routeAtPorts(Avoid, artifacts, plain) ?? plain;
        const searched = searchPorts(artifacts, start, {
          relay: (a, list, ids) => routeAtPorts(Avoid, a, list, ids),
        });
        return searched.costAfter < searched.costBefore ? searched.arrows : start;
      });
    } catch {
      continue;
    }
    if (!free || !hybrid) continue;

    for (const [key, list, ms] of [
      ['oursPlain', plain, tPlain],
      ['oursSearch', search, tSearch],
      ['avoidFree', free, tFree],
      ['hybrid', hybrid, tHybrid],
    ] as const) {
      const q = boardQuality(artifacts, list);
      acc[key].cost += q.cost;
      acc[key].cross += q.counts.arrowArrow;
      acc[key].bends += list.reduce((s, a) => s + a.bends.length, 0);
      acc[key].ms += ms;
      acc[key].n += 1;
    }
  }

  const row = (name: string, a: ReturnType<typeof stats>) =>
    `| ${name} | ${Math.round((a.cost / a.n) * 10) / 10} | ${a.cross} | ${a.bends} | ${Math.round(a.ms / a.n)} |`;
  console.log('Расстановка одна и та же — наша. Различается только прокладка линий.\n');
  console.log('| роутер | средний cost | пересечений | изгибов | мс на доску |');
  console.log('|---|---|---|---|---|');
  console.log(row('наш', acc.oursPlain));
  console.log(row('наш + перебор портов', acc.oursSearch));
  console.log(row('libavoid сам по себе', acc.avoidFree));
  console.log(row('libavoid + наш перебор', acc.hybrid));
  console.log(`\nдосок: ${acc.oursPlain.n}`);
};

main();
