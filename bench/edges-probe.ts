/** What do ELK and dagre actually return for edges? Read, do not recite. */
import { createRequire } from 'node:module';
import { loadCases } from './offline.js';

const require = createRequire(import.meta.url);
const dagre = require('@dagrejs/dagre');
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();

const item = loadCases().find((c) => c.name.includes('E08/wiki-anime'))!;
const { artifacts, arrows } = item.state;
const ids = new Set(artifacts.map((a) => a.id));
const edges = arrows
  .filter((a) => ids.has(a.from.artifactId) && ids.has(a.to.artifactId))
  .filter((a) => a.from.artifactId !== a.to.artifactId);

const main = async () => {
  for (const routing of ['ORTHOGONAL', 'POLYLINE', 'SPLINES']) {
    const laid: any = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': routing,
      },
      children: artifacts.map((a) => ({ id: a.id, width: a.width, height: a.height })),
      edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from.artifactId], targets: [e.to.artifactId] })),
    });
    const first = laid.edges?.[0];
    const sections = first?.sections ?? [];
    const bends = sections.reduce((n: number, s: any) => n + (s.bendPoints?.length ?? 0), 0);
    console.log(`ELK ${routing.padEnd(11)} секций ${sections.length}, точек изгиба у первого ребра ${bends}`);
    if (routing === 'ORTHOGONAL' && sections[0]) {
      console.log('   поля секции:', Object.keys(sections[0]).join(', '));
      console.log('   пример:', JSON.stringify(sections[0]).slice(0, 220));
    }
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 160 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const a of artifacts) g.setNode(a.id, { width: a.width, height: a.height });
  for (const e of edges) g.setEdge(e.from.artifactId, e.to.artifactId);
  dagre.layout(g);
  const de = g.edge(g.edges()[0]);
  console.log(`\ndagre: поля ребра — ${Object.keys(de).join(', ')}`);
  console.log('   точек в polyline:', de.points?.length);
  console.log('   пример:', JSON.stringify(de.points).slice(0, 200));

  const longest = g.edges().map((k: any) => g.edge(k).points.length);
  console.log('   точек на ребро по всему графу:', longest.join(', '));
};

main();
