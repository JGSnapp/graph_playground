/**
 * libavoid as a router for our boards.
 *
 * libavoid (the router behind Inkscape and Dunnart) takes obstacles and
 * connectors and returns orthogonal polylines. Two ways to use it:
 *
 *  - `routeFree` lets it choose where to attach. Fewest bends, but it ignores
 *    whatever sides the layout or the agent asked for.
 *  - `routeAtPorts` pins each end to the exact point our side/offset implies,
 *    with the outward direction of that side. That is what makes it usable
 *    under the port search: moving a port changes the pin, and libavoid draws
 *    the line for it.
 */
import type { Arrow, Artifact } from '@teca/shared';
import { AvoidLib } from 'libavoid-js';

/** libavoid's direction flags, as used by `ShapeConnectionPin`. */
const DIRECTION = { top: 1, bottom: 2, left: 4, right: 8, any: 15 } as const;

let instance: any = null;

export const loadAvoid = async (): Promise<any> => {
  if (!instance) {
    await AvoidLib.load();
    instance = AvoidLib.getInstance();
  }
  return instance;
};

const makeRouter = (Avoid: any) => {
  // Embind exposes enum members as objects; the number lives on `.value`.
  const router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
  router.setRoutingParameter(Avoid.RoutingParameter.shapeBufferDistance, 16);
  router.setRoutingParameter(Avoid.RoutingParameter.idealNudgingDistance, 16);
  router.setRoutingOption(Avoid.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes, true);
  router.setRoutingOption(Avoid.RoutingOption.nudgeSharedPathsWithCommonEndPoint, true);
  return router;
};

const addShapes = (Avoid: any, router: any, artifacts: Artifact[]) => {
  const shapes = new Map<string, any>();
  for (const a of artifacts) {
    const rect = new Avoid.Rectangle(
      new Avoid.Point(a.x, a.y),
      new Avoid.Point(a.x + a.width, a.y + a.height),
    );
    shapes.set(a.id, new Avoid.ShapeRef(router, rect));
  }
  return shapes;
};

/** Where on the box a side/offset pair sits, as proportions of width/height. */
const pinPosition = (side: string, offset: number): { x: number; y: number; dir: number } => {
  switch (side) {
    case 'top':
      return { x: offset, y: 0, dir: DIRECTION.top };
    case 'bottom':
      return { x: offset, y: 1, dir: DIRECTION.bottom };
    case 'left':
      return { x: 0, y: offset, dir: DIRECTION.left };
    case 'right':
      return { x: 1, y: offset, dir: DIRECTION.right };
    default:
      return { x: 0.5, y: 0.5, dir: DIRECTION.any };
  }
};

const readRoute = (conn: any): Array<{ x: number; y: number }> => {
  const route = conn.displayRoute();
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < route.size(); i++) {
    const p = route.ps.get(i);
    points.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return points;
};

const usable = (arrows: Arrow[], ids: Set<string>): Arrow[] =>
  arrows.filter(
    (a) =>
      ids.has(a.from.artifactId) &&
      ids.has(a.to.artifactId) &&
      a.from.artifactId !== a.to.artifactId,
  );

/** libavoid picks the attachment points itself. */
export const routeFree = (Avoid: any, artifacts: Artifact[], arrows: Arrow[]): Arrow[] => {
  const router = makeRouter(Avoid);
  const shapes = addShapes(Avoid, router, artifacts);
  const ids = new Set(artifacts.map((a) => a.id));
  const connectors = new Map<string, any>();

  let pinClass = 1;
  for (const arrow of usable(arrows, ids)) {
    const from = pinClass++;
    const to = pinClass++;
    for (const [artifactId, classId] of [
      [arrow.from.artifactId, from],
      [arrow.to.artifactId, to],
    ] as const) {
      const pin = new Avoid.ShapeConnectionPin(
        shapes.get(artifactId), classId, 0.5, 0.5, true, 0, DIRECTION.any,
      );
      pin.setExclusive(false);
    }
    connectors.set(
      arrow.id,
      new Avoid.ConnRef(
        router,
        new Avoid.ConnEnd(shapes.get(arrow.from.artifactId), from),
        new Avoid.ConnEnd(shapes.get(arrow.to.artifactId), to),
      ),
    );
  }
  router.processTransaction();

  return arrows.map((arrow) => {
    const conn = connectors.get(arrow.id);
    if (!conn) return arrow;
    const points = readRoute(conn);
    if (points.length < 2) return arrow;
    return {
      ...arrow,
      // The board re-derives the endpoints from the ports; only the interior
      // of the polyline is stored.
      bends: points.slice(1, -1),
      routing: 'orthogonal' as const,
      from: { ...arrow.from, side: 'auto' as const, offset: undefined },
      to: { ...arrow.to, side: 'auto' as const, offset: undefined },
    };
  });
};

/**
 * libavoid draws the lines, but the attachment points are ours: each end is
 * pinned exactly where its side and offset say, leaving in that side's
 * direction. This is the form the port search can drive.
 */
export const routeAtPorts = (
  Avoid: any,
  artifacts: Artifact[],
  arrows: Arrow[],
  arrowIds?: string[],
): Arrow[] | null => {
  const wanted = arrowIds ? new Set(arrowIds) : null;
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const router = makeRouter(Avoid);
  const shapes = addShapes(Avoid, router, artifacts);
  const ids = new Set(artifacts.map((a) => a.id));
  const connectors = new Map<string, any>();

  let pinClass = 1;
  for (const arrow of usable(arrows, ids)) {
    const ends: number[] = [];
    for (const end of ['from', 'to'] as const) {
      const endpoint = arrow[end];
      const artifact = byId.get(endpoint.artifactId)!;
      const classId = pinClass++;
      const spot = pinPosition(endpoint.side, endpoint.offset ?? 0.5);
      const pin = new Avoid.ShapeConnectionPin(
        shapes.get(artifact.id), classId, spot.x, spot.y, true, 0, spot.dir,
      );
      pin.setExclusive(false);
      ends.push(classId);
    }
    connectors.set(
      arrow.id,
      new Avoid.ConnRef(
        router,
        new Avoid.ConnEnd(shapes.get(arrow.from.artifactId), ends[0]),
        new Avoid.ConnEnd(shapes.get(arrow.to.artifactId), ends[1]),
      ),
    );
  }
  router.processTransaction();

  return arrows.map((arrow) => {
    if (wanted && !wanted.has(arrow.id)) return arrow;
    const conn = connectors.get(arrow.id);
    if (!conn) return arrow;
    const points = readRoute(conn);
    if (points.length < 2) return arrow;
    return { ...arrow, bends: points.slice(1, -1), routing: 'orthogonal' as const };
  });
};
