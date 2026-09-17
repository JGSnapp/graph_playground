/**
 * What `board_route_arrows` would leave behind, three ways.
 *
 *   как есть   — the board as the agent left it
 *   перепрокид — today's tool: route everything, then search ports
 *   без прокида— search ports on the agent's own attachments
 *   лучший     — whichever of the two scores better
 */
import { boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { loadCases } from './offline.js';

const search = (artifacts: Artifact[], arrows: Arrow[]) =>
  searchPorts(artifacts, arrows, {
    lockedArrowIds: arrows.filter((a) => !a.autoPorts).map((a) => a.id),
  }).arrows;

const acc = { as: 0, re: 0, keep: 0, best: 0, xAs: 0, xRe: 0, xKeep: 0, xBest: 0, n: 0, win: 0, lose: 0 };
const t0 = Date.now();
for (const item of loadCases()) {
  const { artifacts, arrows } = item.state;
  if (arrows.length === 0) continue;
  const qAs = boardQuality(artifacts, arrows);

  let rerouted = arrows;
  if (tooTightToRoute(artifacts, arrows).ready) {
    const out = routeArrows(artifacts, arrows);
    if (!out.refused) {
      rerouted = arrows.map((a) => {
        const r = out.routed.find((x) => x.arrowId === a.id);
        return r ? { ...a, bends: r.bends, from: { ...a.from, side: r.fromSide, offset: r.fromOffset }, to: { ...a.to, side: r.toSide, offset: r.toOffset }, autoPorts: true } : a;
      });
    }
  }
  const qRe = boardQuality(artifacts, search(artifacts, rerouted));
  const qKeep = boardQuality(artifacts, search(artifacts, arrows));
  const best = qKeep.cost < qRe.cost ? qKeep : qRe;

  acc.as += qAs.cost; acc.re += qRe.cost; acc.keep += qKeep.cost; acc.best += best.cost;
  acc.xAs += qAs.metrics.crossings; acc.xRe += qRe.metrics.crossings;
  acc.xKeep += qKeep.metrics.crossings; acc.xBest += best.metrics.crossings;
  acc.n += 1;
  if (best.cost < qRe.cost - 1e-6) acc.win += 1;
  if (best.cost > qRe.cost + 1e-6) acc.lose += 1;
  if (Math.abs(qKeep.cost - qRe.cost) > 2) {
    console.log(`${item.name.slice(0, 34).padEnd(34)} как есть ${qAs.score} | перепрокид ${qRe.score} | без прокида ${qKeep.score}`);
  }
}
const r = (v: number) => Math.round((v / acc.n) * 100) / 100;
console.log(`\nдосок ${acc.n}, ${Math.round((Date.now() - t0) / 1000)}с`);
console.log('| вариант | средний штраф | пересечений всего |');
console.log('|---|---|---|');
console.log(`| как есть | ${r(acc.as)} | ${acc.xAs} |`);
console.log(`| перепрокид (сейчас) | ${r(acc.re)} | ${acc.xRe} |`);
console.log(`| только поиск портов | ${r(acc.keep)} | ${acc.xKeep} |`);
console.log(`| лучший из двух | ${r(acc.best)} | ${acc.xBest} |`);
console.log(`лучший из двух выигрывает на ${acc.win} досках, проигрывает на ${acc.lose}`);
