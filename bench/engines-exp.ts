/**
 * Our layered layout against the two engines people actually use: ELK (the
 * Eclipse Layout Kernel, what draw.io and many editors run) and dagre.
 *
 * The comparison is honest only if everything downstream is identical, so each
 * engine is asked for node coordinates, and then the same router lays the
 * arrows and the same `boardQuality` scores the board. What differs is the
 * placement, nothing else.
 */
import { arrangeGraph, boardQuality, routeArrows, searchPorts, tooTightToRoute, type Arrow, type Artifact } from '@teca/shared';
import { createRequire } from 'node:module';

import { loadCases } from './offline.js';

// Both ship CommonJS bundles; a plain ESM import misses their entry points.
const require = createRequire(import.meta.url);
const dagre = require('@dagrejs/dagre');
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();

interface Placed {
  artifacts: Artifact[];
  ms: number;
}

/** Same rule our layout uses: spacing scaled to the median node. */
const spacingFor = (artifacts: Artifact[], horizontal: boolean) => {
  const pick = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const along = pick(artifacts.map((a) => (horizontal ? a.width : a.height)));
  const cross = pick(artifacts.map((a) => (horizontal ? a.height : a.width)));
  return {
    node: Math.round(Math.max(44, cross * 0.55)),
    layer: Math.round(Math.max(130, along * 1.15)),
  };
};

const edgesOf = (arrows: Arrow[], ids: Set<string>) =>
  arrows
    .filter((a) => ids.has(a.from.artifactId) && ids.has(a.to.artifactId))
    .filter((a) => a.from.artifactId !== a.to.artifactId);

const byDagre = (artifacts: Artifact[], arrows: Arrow[], horizontal: boolean): Placed => {
  const started = Date.now();
  const g = new dagre.graphlib.Graph();
  const gap = spacingFor(artifacts, horizontal);
  g.setGraph({ rankdir: horizontal ? 'LR' : 'TB', nodesep: gap.node, ranksep: gap.layer, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const a of artifacts) g.setNode(a.id, { width: a.width, height: a.height });
  const ids = new Set(artifacts.map((a) => a.id));
  for (const e of edgesOf(arrows, ids)) g.setEdge(e.from.artifactId, e.to.artifactId);
  dagre.layout(g);
  return {
    ms: Date.now() - started,
    artifacts: artifacts.map((a) => {
      const n = g.node(a.id);
      return n ? { ...a, x: Math.round(n.x - a.width / 2), y: Math.round(n.y - a.height / 2) } : a;
    }),
  };
};

const byElk = async (artifacts: Artifact[], arrows: Arrow[], horizontal: boolean): Promise<Placed> => {
  const started = Date.now();
  const ids = new Set(artifacts.map((a) => a.id));
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': String(spacingFor(artifacts, horizontal).node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacingFor(artifacts, horizontal).layer),
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: artifacts.map((a) => ({ id: a.id, width: a.width, height: a.height })),
    edges: edgesOf(arrows, ids).map((e, i) => ({
      id: `e${i}`,
      sources: [e.from.artifactId],
      targets: [e.to.artifactId],
    })),
  };
  const laid = (await elk.layout(graph)) as { children?: Array<{ id: string; x?: number; y?: number }> };
  const at = new Map((laid.children ?? []).map((c) => [c.id, c]));
  return {
    ms: Date.now() - started,
    artifacts: artifacts.map((a) => {
      const c = at.get(a.id);
      return c ? { ...a, x: Math.round(c.x ?? a.x), y: Math.round(c.y ?? a.y) } : a;
    }),
  };
};

/**
  * Same router, same metric, for every engine. `withSearch` decides whether the
  * port search runs too — without it the comparison flatters us, because our
  * pipeline would include a step the others were never given.
  */
const scoreOf = (artifacts: Artifact[], arrows: Arrow[], withSearch = false) => {
  const released = arrows.map((a) => ({
    ...a,
    bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));
  if (!tooTightToRoute(artifacts, released).ready) return null;
  const out = routeArrows(artifacts, released);
  if (out.refused) return null;
  let next = released.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, autoPorts: true,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });
  if (withSearch) {
    const searched = searchPorts(artifacts, next);
    if (searched.costAfter < searched.costBefore) next = searched.arrows;
  }
  const q = boardQuality(artifacts, next);
  return { cost: q.cost, score: q.score, crossings: q.counts.arrowArrow, overlaps: q.counts.artifactArtifact };
};

/** Best of the two flow directions, the same choice our own layout makes. */
const bestOfBoth = async (
  artifacts: Artifact[],
  arrows: Arrow[],
  place: (h: boolean) => Placed | Promise<Placed>,
  withSearch = false,
) => {
  let best: { cost: number; score: number; crossings: number; overlaps: number; ms: number } | null = null;
  for (const horizontal of [true, false]) {
    const placed = await place(horizontal);
    const scored = scoreOf(placed.artifacts, arrows, withSearch);
    if (!scored) continue;
    if (!best || scored.cost < best.cost) best = { ...scored, ms: placed.ms };
  }
  return best;
};

const main = async () => {
  const acc = {
    ours: { cost: 0, cross: 0, over: 0, ms: 0, n: 0 },
    elk: { cost: 0, cross: 0, over: 0, ms: 0, n: 0 },
    elkPlus: { cost: 0, cross: 0, over: 0, ms: 0, n: 0 },
    dagre: { cost: 0, cross: 0, over: 0, ms: 0, n: 0 },
    dagrePlus: { cost: 0, cross: 0, over: 0, ms: 0, n: 0 },
  };
  const wins = { ours: 0, elk: 0, dagre: 0 };

  console.log('случай'.padEnd(30), 'наша', 'ELK'.padStart(7), 'dagre'.padStart(8));
  for (const item of loadCases()) {
    const { artifacts, arrows } = item.state;
    if (arrows.length === 0) continue;

    const t0 = Date.now();
    const ours = arrangeGraph(artifacts, arrows);
    const oursMs = Date.now() - t0;
    const oursQ = boardQuality(ours.artifacts, ours.arrows);

    const elkR = await bestOfBoth(artifacts, arrows, (h) => byElk(artifacts, arrows, h));
    const dagreR = await bestOfBoth(artifacts, arrows, (h) => byDagre(artifacts, arrows, h));
    // The decisive pair: their placement, our port search on top.
    const elkPlus = await bestOfBoth(artifacts, arrows, (h) => byElk(artifacts, arrows, h), true);
    const dagrePlus = await bestOfBoth(artifacts, arrows, (h) => byDagre(artifacts, arrows, h), true);
    if (!elkR || !dagreR || !elkPlus || !dagrePlus) continue;

    console.log(
      item.name.slice(0, 30).padEnd(30),
      String(oursQ.cost).padStart(5),
      String(elkR.cost).padStart(7),
      String(dagreR.cost).padStart(8),
    );
    acc.ours.cost += oursQ.cost; acc.ours.cross += oursQ.counts.arrowArrow;
    acc.ours.over += oursQ.counts.artifactArtifact; acc.ours.ms += oursMs; acc.ours.n++;
    acc.elk.cost += elkR.cost; acc.elk.cross += elkR.crossings; acc.elk.over += elkR.overlaps;
    acc.elk.ms += elkR.ms; acc.elk.n++;
    acc.dagre.cost += dagreR.cost; acc.dagre.cross += dagreR.crossings; acc.dagre.over += dagreR.overlaps;
    acc.dagre.ms += dagreR.ms; acc.dagre.n++;
    acc.elkPlus.cost += elkPlus.cost; acc.elkPlus.cross += elkPlus.crossings;
    acc.elkPlus.over += elkPlus.overlaps; acc.elkPlus.ms += elkPlus.ms; acc.elkPlus.n++;
    acc.dagrePlus.cost += dagrePlus.cost; acc.dagrePlus.cross += dagrePlus.crossings;
    acc.dagrePlus.over += dagrePlus.overlaps; acc.dagrePlus.ms += dagrePlus.ms; acc.dagrePlus.n++;

    const lowest = Math.min(oursQ.cost, elkR.cost, dagreR.cost);
    if (oursQ.cost === lowest) wins.ours++;
    else if (elkR.cost === lowest) wins.elk++;
    else wins.dagre++;
  }

  const row = (name: string, a: typeof acc.ours) =>
    `| ${name} | ${Math.round((a.cost / a.n) * 10) / 10} | ${a.cross} | ${a.over} | ${Math.round(a.ms / a.n)} |`;
  console.log(`\n| движок | средний cost | пересечений | наложений | мс на доску |`);
  console.log('|---|---|---|---|---|');
  console.log(row('наш layout + перебор портов', acc.ours));
  console.log(row('ELK layered', acc.elk));
  console.log(row('dagre', acc.dagre));
  console.log(row('ELK + наш перебор портов', acc.elkPlus));
  console.log(row('dagre + наш перебор портов', acc.dagrePlus));
  console.log(`\nлучший результат: наш ${wins.ours}, ELK ${wins.elk}, dagre ${wins.dagre} из ${acc.ours.n}`);
};

main();
