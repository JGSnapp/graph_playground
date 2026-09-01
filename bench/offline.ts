/**
 * Offline experiments on real board states — no LLM, no money, fully repeatable.
 *
 * Node placement is taken as-is from a saved board; only the routing stage is
 * re-run with different parameters. That isolates "how much of the mess is the
 * router" from "how much is the agent's placement".
 *
 *   tsx bench/offline.ts                          baseline vs re-route
 *   tsx bench/offline.ts --sweep=lanesPerGap:4,8,12,16
 *   tsx bench/offline.ts --png=out/offline        also dump PNGs
 */
import {
  boardQuality,
  routeArrows,
  tooTightToRoute,
  type Arrow,
  type Artifact,
  type BoardState,
} from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe } from './metrics.js';
import { boardPng } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const argOf = (name: string, fallback = ''): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

export interface Case {
  name: string;
  state: BoardState;
}

/** Real boards produced by real agent runs, plus anything dropped in bench/cases. */
export const loadCases = (): Case[] => {
  const cases: Case[] = [];
  const boardsFile = path.resolve(here, '../data/boards.json');
  if (fs.existsSync(boardsFile)) {
    const data = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
    for (const record of data.boards) {
      const state: BoardState = record.board.state;
      if (state.artifacts.length === 0 || state.arrows.length === 0) continue;
      cases.push({ name: `${record.board.id}(${record.board.title})`, state });
    }
  }
  const benchOut = path.resolve(here, 'out');
  if (fs.existsSync(benchOut)) {
    for (const exp of fs.readdirSync(benchOut)) {
      const dir = path.join(benchOut, exp);
      if (!fs.statSync(dir).isDirectory() || exp === 'existing') continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!data.state || data.state.arrows.length === 0) continue;
        cases.push({ name: `${exp}/${file.replace('.json', '')}`, state: data.state });
      }
    }
  }
  return cases;
};

const applyRoutes = (arrows: Arrow[], routed: ReturnType<typeof routeArrows>['routed']): Arrow[] =>
  arrows.map((arrow) => {
    const match = routed.find((item) => item.arrowId === arrow.id);
    if (!match) return arrow;
    return {
      ...arrow,
      bends: match.bends,
      routing: 'orthogonal' as const,
      from: { ...arrow.from, side: match.fromSide, offset: match.fromOffset },
      to: { ...arrow.to, side: match.toSide, offset: match.toOffset },
    };
  });

export interface Outcome {
  cost: number;
  score: number;
  counts: Record<string, number>;
  refused: boolean;
  hooks: number;
  arrows: Arrow[];
}

export const reroute = (
  artifacts: Artifact[],
  arrows: Arrow[],
  options: Record<string, unknown> = {},
): Outcome => {
  const gate = tooTightToRoute(artifacts, arrows);
  if (!gate.ready) {
    const quality = boardQuality(artifacts, arrows);
    return {
      cost: quality.cost,
      score: quality.score,
      counts: quality.counts as unknown as Record<string, number>,
      refused: true,
      hooks: 0,
      arrows,
    };
  }
  const result = routeArrows(artifacts, arrows, options);
  const next = applyRoutes(arrows, result.routed);
  const quality = boardQuality(artifacts, next);
  return {
    cost: quality.cost,
    score: quality.score,
    counts: quality.counts as unknown as Record<string, number>,
    refused: Boolean(result.refused),
    hooks: result.routed.filter((r) => r.hook).length,
    arrows: next,
  };
};

const pad = (value: unknown, width: number): string => String(value).padStart(width);

const main = () => {
  const cases = loadCases();
  const pngDir = argOf('png');
  if (pngDir) fs.mkdirSync(path.resolve(here, '..', pngDir), { recursive: true });

  const sweep = argOf('sweep');
  const variants: Array<{ label: string; options: Record<string, unknown> }> = [
    { label: 'as-is', options: {} },
  ];
  if (sweep) {
    const [key, listed] = sweep.split(':');
    for (const value of listed.split(',')) {
      variants.push({ label: `${key}=${value}`, options: { [key]: Number(value) } });
    }
  } else {
    variants.push({ label: 're-route', options: {} });
  }

  const totals = new Map<string, { cost: number; score: number; hooks: number; n: number }>();

  console.log(`\nслучаев: ${cases.length}\n`);
  const header = ['случай'.padEnd(34), 'узл', 'свз', ...variants.map((v) => v.label.padStart(14))].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const item of cases) {
    const row: string[] = [
      item.name.slice(0, 34).padEnd(34),
      pad(item.state.artifacts.length, 3),
      pad(item.state.arrows.length, 3),
    ];
    for (const variant of variants) {
      const outcome =
        variant.label === 'as-is'
          ? (() => {
              const quality = boardQuality(item.state.artifacts, item.state.arrows);
              return {
                cost: quality.cost,
                score: quality.score,
                hooks: 0,
                refused: false,
                arrows: item.state.arrows,
              };
            })()
          : reroute(item.state.artifacts, item.state.arrows, variant.options);
      row.push(`${pad(outcome.score, 3)}/${pad(Math.round(outcome.cost), 5)}${outcome.refused ? '✖' : ' '}`.padStart(14));
      const acc = totals.get(variant.label) ?? { cost: 0, score: 0, hooks: 0, n: 0 };
      acc.cost += outcome.cost;
      acc.score += outcome.score;
      acc.hooks += outcome.hooks ?? 0;
      acc.n += 1;
      totals.set(variant.label, acc);

      if (pngDir && variant.label !== 'as-is') {
        const stem = `${item.name.replace(/[^\w.-]/g, '_')}__${variant.label.replace(/[^\w=.-]/g, '_')}`;
        fs.writeFileSync(
          path.resolve(here, '..', pngDir, `${stem}.png`),
          boardPng({ ...item.state, arrows: outcome.arrows }),
        );
      }
    }
    console.log(row.join(' '));
  }

  console.log(`\nИтого (среднее по ${cases.length} случаям):`);
  console.log('| вариант | средн. score | средн. cost | крюков |');
  console.log('|---|---|---|---|');
  for (const [label, acc] of totals) {
    console.log(
      `| ${label} | ${Math.round((acc.score / acc.n) * 10) / 10} | ${Math.round((acc.cost / acc.n) * 10) / 10} | ${acc.hooks} |`,
    );
  }
};

if (process.argv[1] && process.argv[1].endsWith('offline.ts')) main();
