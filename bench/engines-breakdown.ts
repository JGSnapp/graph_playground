/** Where exactly does our cost advantage over ELK come from? */
import { arrangeGraph, boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { createRequire } from 'node:module';
import { loadCases } from './offline.js';

const require = createRequire(import.meta.url);
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();

const spacingFor = (artifacts: Artifact[], horizontal: boolean) => {
  const pick = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const along = pick(artifacts.map((a) => (horizontal ? a.width : a.height)));
  const cross = pick(artifacts.map((a) => (horizontal ? a.height : a.width)));
  return { node: Math.round(Math.max(44, cross * 0.55)), layer: Math.round(Math.max(130, along * 1.15)) };
};

const byElk = async (artifacts: Artifact[], arrows: Arrow[], horizontal: boolean): Promise<Artifact[]> => {
  const ids = new Set(artifacts.map((a) => a.id));
  const gap = spacingFor(artifacts, horizontal);
  const laid: any = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': String(gap.node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(gap.layer),
    },
    children: artifacts.map((a) => ({ id: a.id, width: a.width, height: a.height })),
    edges: arrows
      .filter((a) => ids.has(a.from.artifactId) && ids.has(a.to.artifactId) && a.from.artifactId !== a.to.artifactId)
      .map((e, i) => ({ id: `e${i}`, sources: [e.from.artifactId], targets: [e.to.artifactId] })),
  });
  const at = new Map((laid.children ?? []).map((c: any) => [c.id, c]));
  return artifacts.map((a) => {
    const c: any = at.get(a.id);
    return c ? { ...a, x: Math.round(c.x ?? a.x), y: Math.round(c.y ?? a.y) } : a;
  });
};

const layAndSearch = (artifacts: Artifact[], arrows: Arrow[]) => {
  const released = arrows.map((a) => ({
    ...a, bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));
  if (!tooTightToRoute(artifacts, released).ready) return null;
  const out = routeArrows(artifacts, released);
  if (out.refused) return null;
  let next = released.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m ? { ...a, bends: m.bends, autoPorts: true,
      from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
      to: { ...a.to, side: m.toSide, offset: m.toOffset } } : a;
  });
  const searched = searchPorts(artifacts, next);
  if (searched.costAfter < searched.costBefore) next = searched.arrows;
  return next;
};

const main = async () => {
  const ours: Record<string, number> = {};
  const theirs: Record<string, number> = {};
  const add = (into: Record<string, number>, counts: Record<string, number>) => {
    for (const [k, v] of Object.entries(counts)) into[k] = (into[k] ?? 0) + v;
  };
  let n = 0;
  const stretch: number[] = [];
  const stretchElk: number[] = [];
  const box = (a: Artifact[]) => {
    const x1 = Math.min(...a.map((v) => v.x)), y1 = Math.min(...a.map((v) => v.y));
    const x2 = Math.max(...a.map((v) => v.x + v.width)), y2 = Math.max(...a.map((v) => v.y + v.height));
    const r = (x2 - x1) / Math.max(1, y2 - y1);
    return Math.max(r, 1 / r);
  };

  for (const item of loadCases()) {
    if (item.state.arrows.length === 0) continue;
    const o = arrangeGraph(item.state.artifacts, item.state.arrows);
    add(ours, boardQuality(o.artifacts, o.arrows).counts as any);
    stretch.push(box(o.artifacts));

    let best: { a: Artifact[]; arr: Arrow[]; cost: number } | null = null;
    for (const h of [true, false]) {
      const placed = await byElk(item.state.artifacts, item.state.arrows, h);
      const laid = layAndSearch(placed, item.state.arrows);
      if (!laid) continue;
      const cost = boardQuality(placed, laid).cost;
      if (!best || cost < best.cost) best = { a: placed, arr: laid, cost };
    }
    if (!best) continue;
    add(theirs, boardQuality(best.a, best.arr).counts as any);
    stretchElk.push(box(best.a));
    n += 1;
  }

  const WEIGHT: Record<string, number> = {
    artifactArtifact: 15, arrowArtifact: 12, arrowOverlap: 8, arrowPortAngle: 8,
    arrowSharedPort: 8, arrowArrow: 4, arrowShortEdge: 4, labelConflict: 3,
    arrowClearance: 2, tightSpacing: 1.5,
  };
  console.log('нарушение'.padEnd(20), 'наш', 'ELK+перебор', 'вклад в штраф');
  for (const key of Object.keys(WEIGHT)) {
    const a = ours[key] ?? 0, b = theirs[key] ?? 0;
    if (a === 0 && b === 0) continue;
    const diff = (b - a) * WEIGHT[key];
    console.log(key.padEnd(20), String(a).padStart(4), String(b).padStart(11),
      `${diff > 0 ? '+' : ''}${Math.round(diff)} у ELK`.padStart(16));
  }
  const avg = (v: number[]) => Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
  console.log(`\nвытянутость: наш ${avg(stretch)} | ELK ${avg(stretchElk)}   (досок ${n})`);
};

main();
