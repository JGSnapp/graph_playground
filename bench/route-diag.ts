/** Where do the crossings on a given board actually come from? */
import { boundsOf, checkIntersections, routeArrows, type Arrow } from '@teca/shared';
import fs from 'node:fs';

const task = process.argv[2] ?? 'extend-existing';
const exp = process.argv[3] ?? 'E05';
const r = JSON.parse(fs.readFileSync(`bench/out/${exp}/${task}__deepseek-v4-flash.json`, 'utf8'));
const { artifacts, arrows } = r.state;
const box = boundsOf(artifacts);

const apply = (list: Arrow[], routed: ReturnType<typeof routeArrows>['routed']): Arrow[] =>
  list.map((a) => {
    const m = routed.find((x) => x.arrowId === a.id);
    return m
      ? { ...a, bends: m.bends, routing: 'orthogonal' as const,
          from: { ...a.from, side: m.fromSide, offset: m.fromOffset },
          to: { ...a.to, side: m.toSide, offset: m.toOffset } }
      : a;
  });

for (const rings of [0, 3]) {
  const out = routeArrows(artifacts, arrows, { outerRings: rings, crossPenalty: 400 });
  const next = apply(arrows, out.routed);
  const outside = next.reduce(
    (n, a) => n + a.bends.filter((b) => b.x < box.x - 30 || b.x > box.x + box.width + 30 ||
      b.y < box.y - 30 || b.y > box.y + box.height + 30).length, 0);
  const report = checkIntersections(artifacts, next);
  const shared = report.findings.filter((f) => {
    if (f.kind !== 'arrow_arrow') return false;
    const a = arrows.find((x: Arrow) => x.id === f.arrowAId)!;
    const b = arrows.find((x: Arrow) => x.id === f.arrowBId)!;
    const ends = new Set([a.from.artifactId, a.to.artifactId]);
    return ends.has(b.from.artifactId) || ends.has(b.to.artifactId);
  }).length;
  console.log(
    `колец ${rings}: пересечений ${report.counts.arrowArrow}`,
    `| из них у стрелок с общим узлом: ${shared}`,
    `| точек сгиба снаружи композиции: ${outside}`,
    `| всего сгибов: ${next.reduce((n, a) => n + a.bends.length, 0)}`,
  );
}
