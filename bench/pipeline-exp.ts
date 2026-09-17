/**
 * The whole `board_route_arrows` pipeline, old against new.
 *
 *   старый — re-route everything, then the port search, and take it
 *   новый  — best of four: re-laid or kept × detour on or off
 */
import { boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const limit = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 60);
const withPorts = (artifacts: Artifact[], arrows: Arrow[], detour: boolean) =>
  searchPorts(artifacts, arrows, {
    detour,
    lockedArrowIds: arrows.filter((a) => !a.autoPorts).map((a) => a.id),
  });

const acc = { old: 0, now: 0, xOld: 0, xNow: 0, tOld: 0, tNow: 0, n: 0, win: 0, lose: 0 };
for (const item of loadCases().slice(0, limit)) {
  const { artifacts, arrows } = item.state;
  if (arrows.length === 0) continue;

  let relaid = arrows;
  if (tooTightToRoute(artifacts, arrows).ready) {
    const out = routeArrows(artifacts, arrows);
    if (!out.refused) relaid = arrows.map((a) => {
      const r = out.routed.find((x) => x.arrowId === a.id);
      return r ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset }, autoPorts: true } : a;
    });
  }

  const t0 = Date.now();
  const old = withPorts(artifacts, relaid, false);
  const tOld = Date.now() - t0;
  const oldQ = boardQuality(artifacts, old.costAfter < old.costBefore ? old.arrows : relaid);

  const t1 = Date.now();
  const relaidQ = boardQuality(artifacts, relaid);
  const runs = [withPorts(artifacts, relaid, true), withPorts(artifacts, arrows, true)];
  if (relaidQ.counts.arrowArrow > 0) runs.push(old, withPorts(artifacts, arrows, false));
  let bestArrows = relaid;
  let bestCost = relaidQ.cost;
  for (const run of runs) if (run.costAfter < bestCost) { bestArrows = run.arrows; bestCost = run.costAfter; }
  const tNow = Date.now() - t1;
  const nowQ = boardQuality(artifacts, bestArrows);

  acc.old += oldQ.cost; acc.now += nowQ.cost;
  acc.xOld += oldQ.metrics.crossings; acc.xNow += nowQ.metrics.crossings;
  acc.tOld += tOld; acc.tNow += tNow; acc.n += 1;
  if (nowQ.cost < oldQ.cost - 1e-6) acc.win += 1;
  if (nowQ.cost > oldQ.cost + 1e-6) acc.lose += 1;
  if (Math.abs(nowQ.cost - oldQ.cost) > 2) {
    console.log(`${item.name.slice(0, 34).padEnd(34)} ${oldQ.score} → ${nowQ.score}`);
  }
}
const r = (v: number) => Math.round((v / acc.n) * 100) / 100;
console.log(`\nдосок ${acc.n}`);
console.log('| конвейер | средний штраф | пересечений | среднее время, с |');
console.log('|---|---|---|---|');
console.log(`| старый | ${r(acc.old)} | ${acc.xOld} | ${r(acc.tOld / 1000)} |`);
console.log(`| новый | ${r(acc.now)} | ${acc.xNow} | ${r(acc.tNow / 1000)} |`);
console.log(`новый лучше на ${acc.win} досках, хуже на ${acc.lose}`);
