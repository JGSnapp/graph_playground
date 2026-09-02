/**
 * Whose edge routing is better — ours or libavoid's — on OUR node placement.
 *
 * The placement is not up for comparison: putting related things together and
 * unrelated things apart is what this system is for, and no general layout
 * engine knows what the nodes mean. So the layout is fixed to ours and only the
 * lines differ.
 *
 * ELK is not in this comparison because it cannot be: asked to keep the given
 * coordinates (`org.eclipse.elk.fixed`) it returns no edge routes at all, and
 * asked to route (`layered` with every INTERACTIVE strategy) it still moves
 * nodes by hundreds of pixels. Its orthogonal routing is a phase inside its own
 * placement and does not come apart from it.
 *
 * libavoid does exactly this job: obstacles in, connectors out. It is the
 * router behind Inkscape and Dunnart.
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
import { loadCases } from './offline.js';
import { AvoidLib } from 'libavoid-js';

const released = (arrows: Arrow[]): Arrow[] =>
  arrows.map((a) => ({
    ...a,
    bends: [],
    from: { ...a.from, side: 'auto' as const, offset: undefined },
    to: { ...a.to, side: 'auto' as const, offset: undefined },
  }));

const ourRouter = (artifacts: Artifact[], arrows: Arrow[], withSearch: boolean): Arrow[] | null => {
  const fresh = released(arrows);
  if (!tooTightToRoute(artifacts, fresh).ready) return null;
  const out = routeArrows(artifacts, fresh);
  if (out.refused) return null;
  let next = fresh.map((a) => {
    const m = out.routed.find((x) => x.arrowId === a.id);
    return m
      ? {
          ...a,
          bends: m.bends,
          autoPorts: true,
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

/**
 * libavoid: every artifact becomes an obstacle, every arrow a connector whose
 * ends float anywhere on their box. The returned polyline is written straight
 * into `bends`, minus the two endpoints, which the board derives from the ports.
 */
const libavoidRouter = (Avoid: any, artifacts: Artifact[], arrows: Arrow[]): Arrow[] | null => {
  // Embind exposes enum members as objects; the number lives on `.value`.
  const router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
  router.setRoutingParameter(Avoid.RoutingParameter.shapeBufferDistance, 16);
  router.setRoutingParameter(Avoid.RoutingParameter.idealNudgingDistance, 16);
  router.setRoutingOption(Avoid.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes, true);
  router.setRoutingOption(Avoid.RoutingOption.nudgeSharedPathsWithCommonEndPoint, true);

  const shapes = new Map<string, any>();
  for (const a of artifacts) {
    const topLeft = new Avoid.Point(a.x, a.y);
    const bottomRight = new Avoid.Point(a.x + a.width, a.y + a.height);
    const rect = new Avoid.Rectangle(topLeft, bottomRight);
    shapes.set(a.id, new Avoid.ShapeRef(router, rect));
  }

  const ids = new Set(artifacts.map((a) => a.id));
  const connectors = new Map<string, any>();
  for (const arrow of arrows) {
    if (!ids.has(arrow.from.artifactId) || !ids.has(arrow.to.artifactId)) continue;
    if (arrow.from.artifactId === arrow.to.artifactId) continue;
    // 15 is libavoid's "any side" pin: the router picks where to attach.
    const src = new Avoid.ShapeConnectionPin(shapes.get(arrow.from.artifactId), 1, 0.5, 0.5, true, 0, 15);
    const dst = new Avoid.ShapeConnectionPin(shapes.get(arrow.to.artifactId), 2, 0.5, 0.5, true, 0, 15);
    src.setExclusive(false);
    dst.setExclusive(false);
    connectors.set(
      arrow.id,
      new Avoid.ConnRef(
        router,
        new Avoid.ConnEnd(shapes.get(arrow.from.artifactId), 1),
        new Avoid.ConnEnd(shapes.get(arrow.to.artifactId), 2),
      ),
    );
  }

  router.processTransaction();

  const out = arrows.map((arrow) => {
    const conn = connectors.get(arrow.id);
    if (!conn) return arrow;
    const route = conn.displayRoute();
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < route.size(); i++) {
      const p = route.ps.get(i);
      points.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
    if (points.length < 2) return arrow;
    return {
      ...arrow,
      // The first and last points sit on the boxes; the board re-derives those
      // from the ports, so only the interior is stored.
      bends: points.slice(1, -1),
      routing: 'orthogonal' as const,
      from: { ...arrow.from, side: 'auto' as const, offset: undefined },
      to: { ...arrow.to, side: 'auto' as const, offset: undefined },
    };
  });

  return out;
};

const main = async () => {
  await AvoidLib.load();
  const Avoid = AvoidLib.getInstance();

  const acc = {
    plain: { cost: 0, cross: 0, bends: 0, ms: 0, n: 0 },
    search: { cost: 0, cross: 0, bends: 0, ms: 0, n: 0 },
    avoid: { cost: 0, cross: 0, bends: 0, ms: 0, n: 0 },
  };
  let failures = 0;

  for (const item of loadCases()) {
    if (item.state.arrows.length === 0) continue;
    // One fixed placement — ours — for every router.
    const placed = arrangeGraph(item.state.artifacts, item.state.arrows, { searchPorts: false });
    const { artifacts } = placed;
    const arrows = placed.arrows;

    const t0 = Date.now();
    const plain = ourRouter(artifacts, arrows, false);
    const tPlain = Date.now() - t0;
    const t1 = Date.now();
    const search = ourRouter(artifacts, arrows, true);
    const tSearch = Date.now() - t1;
    if (!plain || !search) continue;

    let avoid: Arrow[] | null = null;
    let tAvoid = 0;
    try {
      const t2 = Date.now();
      avoid = libavoidRouter(Avoid, artifacts, arrows);
      tAvoid = Date.now() - t2;
    } catch (error) {
      failures += 1;
      if (failures <= 2) console.error('libavoid:', (error as Error).message.slice(0, 120));
    }
    if (!avoid) continue;

    for (const [key, list, ms] of [
      ['plain', plain, tPlain],
      ['search', search, tSearch],
      ['avoid', avoid, tAvoid],
    ] as const) {
      const q = boardQuality(artifacts, list);
      acc[key].cost += q.cost;
      acc[key].cross += q.counts.arrowArrow;
      acc[key].bends += list.reduce((s, a) => s + a.bends.length, 0);
      acc[key].ms += ms;
      acc[key].n += 1;
    }
  }

  const row = (name: string, a: typeof acc.plain) =>
    `| ${name} | ${Math.round((a.cost / a.n) * 10) / 10} | ${a.cross} | ${a.bends} | ${Math.round(a.ms / a.n)} |`;
  console.log('Расстановка одна и та же — наша. Различается только прокладка линий.\n');
  console.log('| роутер | средний cost | пересечений | изгибов всего | мс на доску |');
  console.log('|---|---|---|---|---|');
  console.log(row('наш', acc.plain));
  console.log(row('наш + перебор портов', acc.search));
  console.log(row('libavoid (Inkscape)', acc.avoid));
  console.log(`\nдосок в сравнении: ${acc.plain.n}${failures ? `, отказов libavoid: ${failures}` : ''}`);
};

main();
