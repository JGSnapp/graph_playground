/**
 * Aggregates bench/out/<exp>/*.json into a markdown table.
 *
 *   tsx bench/report.ts --exp=E01            one experiment
 *   tsx bench/report.ts --exp=E01,E02        side by side, grouped by task
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, 'out');

const argOf = (name: string, fallback = ''): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

interface Row {
  exp: string;
  task: string;
  model: string;
  score: number;
  cost: number;
  grade: string;
  ok: boolean;
  artifacts: number;
  arrows: number;
  iterations: number | null;
  refusals: number;
  aborted: boolean;
  seconds: number;
  counts: Record<string, number>;
  observations: Record<string, number>;
  toolHistogram: Record<string, number>;
}

const load = (exp: string): Row[] => {
  const dir = path.join(OUT, exp);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((r) => ({
      exp: r.exp,
      task: r.task,
      model: r.model,
      score: r.quality.score,
      cost: r.quality.cost,
      grade: r.quality.grade,
      ok: r.ok,
      artifacts: r.observations.artifacts,
      arrows: r.observations.arrows,
      iterations: r.iterations ?? null,
      refusals: (r.refusals ?? []).length,
      aborted: Boolean(r.aborted),
      seconds: Math.round(r.ms / 1000),
      counts: r.quality.counts,
      observations: r.observations,
      toolHistogram: r.toolHistogram ?? {},
    }));
};

const mean = (values: number[]): number =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;

const main = () => {
  const exps = argOf('exp', 'E01').split(',').map((e) => e.trim()).filter(Boolean);
  const rows = exps.flatMap(load);
  if (rows.length === 0) {
    console.log('нет результатов');
    return;
  }

  console.log(`\n## Прогоны (${rows.length})\n`);
  console.log('| эксп | задача | модель | score | grade | ok | узлы | связи | итер | отказы | сек | A×A | ←→A | ×× | слипн | порт | воздух |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...rows].sort((a, b) => a.task.localeCompare(b.task) || a.exp.localeCompare(b.exp) || a.model.localeCompare(b.model))) {
    console.log(
      `| ${r.exp} | ${r.task} | ${r.model} | ${r.score} | ${r.grade} | ${r.ok ? '✅' : '—'} | ${r.artifacts} | ${r.arrows} | ${r.iterations ?? '?'} | ${r.refusals} | ${r.seconds}${r.aborted ? ' ⛔' : ''} | ${r.counts.artifactArtifact} | ${r.counts.arrowArtifact} | ${r.counts.arrowArrow} | ${r.counts.arrowOverlap} | ${r.counts.arrowPortAngle + r.counts.arrowSharedPort} | ${r.counts.tightSpacing} |`,
    );
  }

  console.log(`\n## Сводка по эксперименту\n`);
  console.log('| эксп | средн. score | медиана | ok-доля | средн. отказов | средн. итераций | fidelity | aspect | spread |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const exp of exps) {
    const group = rows.filter((r) => r.exp === exp);
    if (group.length === 0) continue;
    const scores = group.map((r) => r.score).sort((a, b) => a - b);
    console.log(
      `| ${exp} | ${mean(group.map((r) => r.score))} | ${scores[scores.length >> 1]} | ${Math.round((group.filter((r) => r.ok).length / group.length) * 100)}% | ${mean(group.map((r) => r.refusals))} | ${mean(group.map((r) => r.iterations ?? 0))} | ${mean(group.map((r) => r.observations.neighbourFidelity))} | ${mean(group.map((r) => r.observations.aspect))} | ${mean(group.map((r) => r.observations.edgeLengthSpread))} |`,
    );
  }

  console.log(`\n## Сводка по моделям\n`);
  console.log('| модель | прогонов | средн. score | ok-доля | средн. отказов |');
  console.log('|---|---|---|---|---|');
  for (const model of [...new Set(rows.map((r) => r.model))]) {
    const group = rows.filter((r) => r.model === model);
    console.log(
      `| ${model} | ${group.length} | ${mean(group.map((r) => r.score))} | ${Math.round((group.filter((r) => r.ok).length / group.length) * 100)}% | ${mean(group.map((r) => r.refusals))} |`,
    );
  }

  const tools: Record<string, number> = {};
  for (const r of rows) for (const [name, n] of Object.entries(r.toolHistogram)) tools[name] = (tools[name] ?? 0) + n;
  console.log(`\n## Вызовы инструментов (всего)\n`);
  for (const [name, n] of Object.entries(tools).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${name}: ${n}`);
  }
};

main();
