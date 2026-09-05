/**
 * A rounded corner cuts the polyline by up to 0.29·r, so a crossing that sits
 * within a radius of a corner might not be there once the line is drawn round.
 * The metric reads the polyline; this counts how often the two could disagree.
 */
import { CORNER_RADIUS, checkIntersections, computeArrowGeometries, type Vec2 } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const corners = (points: Vec2[]): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const straight =
      (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
    if (!straight) out.push(b);
  }
  return out;
};

const main = () => {
  let crossings = 0;
  let nearCorner = 0;
  let boards = 0;
  const out = path.join(here, 'out');

  for (const exp of fs.readdirSync(out).filter((d) => /^(E\d+|V\d+)$/.test(d))) {
    for (const file of fs.readdirSync(path.join(out, exp)).filter((f) => f.endsWith('.json'))) {
      const d = JSON.parse(fs.readFileSync(path.join(out, exp, file), 'utf8'));
      if (!d.state?.arrows?.length) continue;
      boards += 1;
      const geometries = computeArrowGeometries(d.state.artifacts, d.state.arrows);
      const bends = new Map<string, Vec2[]>();
      for (const [id, g] of geometries) bends.set(id, corners(g.points));

      for (const f of checkIntersections(d.state.artifacts, d.state.arrows).findings) {
        if (f.kind !== 'arrow_arrow') continue;
        crossings += 1;
        const near = [...(bends.get(f.arrowAId) ?? []), ...(bends.get(f.arrowBId) ?? [])].some(
          (c) => Math.hypot(c.x - f.point.x, c.y - f.point.y) < CORNER_RADIUS,
        );
        if (near) nearCorner += 1;
      }
    }
  }
  console.log(`досок ${boards}, пересечений ${crossings}`);
  console.log(`из них ближе ${CORNER_RADIUS}px к изгибу: ${nearCorner} (${Math.round((nearCorner / Math.max(crossings, 1)) * 100)}%)`);
  console.log('— только эти могут разойтись между ломаной и скруглённой линией.');
};
main();
