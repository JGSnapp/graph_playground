/** The detour pass on and off: quality and the time it costs. */
import { boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const limit = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 40);
const search = (artifacts: Artifact[], arrows: Arrow[], detour: boolean) =>
  searchPorts(artifacts, arrows, {
    detour,
    lockedArrowIds: arrows.filter((a) => !a.autoPorts).map((a) => a.id),
  });

const acc = { off: 0, on: 0, xOff: 0, xOn: 0, tOff: 0, tOn: 0, n: 0, win: 0, lose: 0 };
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
  const best = (detour: boolean) => {
    const t = Date.now();
    const a = search(artifacts, relaid, detour);
    const b = search(artifacts, arrows, detour);
    const cost = Math.min(a.costAfter, b.costAfter);
    const q = boardQuality(artifacts, a.costAfter <= b.costAfter ? a.arrows : b.arrows);
    return { cost, crossings: q.metrics.crossings, ms: Date.now() - t };
  };
  const off = best(false);
  const on = best(true);
  acc.off += off.cost; acc.on += on.cost;
  acc.xOff += off.crossings; acc.xOn += on.crossings;
  acc.tOff += off.ms; acc.tOn += on.ms; acc.n += 1;
  if (on.cost < off.cost - 1e-6) acc.win += 1;
  if (on.cost > off.cost + 1e-6) acc.lose += 1;
  if (Math.abs(on.cost - off.cost) > 1) {
    console.log(`${item.name.slice(0, 34).padEnd(34)} без обхода ${off.cost.toFixed(1)} → с обходом ${on.cost.toFixed(1)}`);
  }
}
const r = (v: number) => Math.round((v / acc.n) * 100) / 100;
console.log(`\nдосок ${acc.n}`);
console.log('| вариант | средний штраф | пересечений | среднее время, с |');
console.log('|---|---|---|---|');
console.log(`| без обхода | ${r(acc.off)} | ${acc.xOff} | ${r(acc.tOff / 1000)} |`);
console.log(`| с обходом | ${r(acc.on)} | ${acc.xOn} | ${r(acc.tOn / 1000)} |`);
console.log(`обход выигрывает на ${acc.win}, проигрывает на ${acc.lose}`);
