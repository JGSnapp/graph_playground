import { boardQuality, routeArrows, tooTightToRoute } from '@teca/shared';
import { loadCases, reroute } from './offline.js';

const name = process.argv[2] ?? 'brd_blbe2739z6';
const item = loadCases().find((c) => c.name.includes(name))!;
const { artifacts, arrows } = item.state;
console.log(item.name, artifacts.length, 'узлов', arrows.length, 'стрелок');
console.log('gate:', JSON.stringify(tooTightToRoute(artifacts, arrows)).slice(0, 200));

const variants: Array<[string, Record<string, unknown>]> = [
  ['default', {}],
  ['lanes16', { lanesPerGap: 16 }],
  ['overlap8', { overlapPenalty: 8 }],
  ['overlap8+lanes16', { overlapPenalty: 8, lanesPerGap: 16 }],
  ['cross200', { crossPenalty: 200 }],
  ['turn40', { turnPenalty: 40 }],
  ['turn40+overlap8+lanes16', { turnPenalty: 40, overlapPenalty: 8, lanesPerGap: 16 }],
  ['margin48', { margin: 48 }],
];
const base = boardQuality(artifacts, arrows);
console.log('as-is  cost', base.cost, JSON.stringify(base.counts));
for (const [label, options] of variants) {
  const r = routeArrows(artifacts, arrows, options);
  const next = arrows.map((a) => {
    const m = r.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, routing: 'orthogonal' as const, from: { ...a.from, side: m.fromSide, offset: m.fromOffset }, to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
  const q = boardQuality(artifacts, next);
  console.log(label.padEnd(24), 'cost', String(Math.round(q.cost)).padStart(4), 'score', String(q.score).padStart(3),
    '| routed', r.routed.length, 'variants', r.variantsTried, 'hooks', r.routed.filter((x) => x.hook).length,
    '|', Object.entries(q.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' '));
}
