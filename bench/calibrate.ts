/**
 * Recomputes the constants in `cost.ts` from real run logs instead of guesses.
 *
 * `TYPICAL_PROMPT_TOKENS` and `TYPICAL_ITERATIONS` were estimates until an
 * actual run existed. This reads `bench/data/runs.json` and prints what the
 * numbers should be, per model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, process.argv[2] ?? 'data/runs.json');

if (!fs.existsSync(file)) {
  console.error(`нет файла ${file}`);
  process.exit(1);
}

interface Row {
  model: string;
  iterations: number;
  prompt: number;
  completion: number;
  cached: number;
  calls: number;
  maxCompletion: number;
}

const runs: Row[] = JSON.parse(fs.readFileSync(file, 'utf8'))
  .runs.filter((run: any) => run.usage?.calls > 0)
  .map((run: any) => ({
    model: run.model,
    iterations: run.iterations.length,
    prompt: run.usage.promptTokens,
    completion: run.usage.completionTokens,
    cached: run.usage.cachedTokens ?? 0,
    calls: run.usage.calls,
    maxCompletion: Math.max(
      0,
      ...run.iterations.map((it: any) => it.usage?.completionTokens ?? 0),
    ),
  }));

if (runs.length === 0) {
  console.log('нет прогонов с отчётом о токенах');
  process.exit(0);
}

const byModel = new Map<string, Row[]>();
for (const row of runs) {
  if (!byModel.has(row.model)) byModel.set(row.model, []);
  byModel.get(row.model)!.push(row);
}

const mean = (values: number[]): number =>
  Math.round(values.reduce((a, b) => a + b, 0) / values.length);

console.log('модель'.padEnd(20), 'досок', 'итер/доска', 'промпт/вызов', 'ответ/вызов', 'макс ответ', 'кэш');
console.log('-'.repeat(88));
for (const [model, rows] of byModel) {
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  const prompt = rows.reduce((s, r) => s + r.prompt, 0);
  const completion = rows.reduce((s, r) => s + r.completion, 0);
  const cached = rows.reduce((s, r) => s + r.cached, 0);
  console.log(
    model.padEnd(20),
    String(rows.length).padStart(5),
    String(mean(rows.map((r) => r.iterations))).padStart(10),
    String(Math.round(prompt / calls)).padStart(12),
    String(Math.round(completion / calls)).padStart(11),
    String(Math.max(...rows.map((r) => r.maxCompletion))).padStart(10),
    `${Math.round((cached / prompt) * 100)}%`.padStart(5),
  );
}

const allCalls = runs.reduce((s, r) => s + r.calls, 0);
const allPrompt = runs.reduce((s, r) => s + r.prompt, 0);
const maxCompletion = Math.max(...runs.map((r) => r.maxCompletion));

console.log('\nЧто поставить в bench/cost.ts:');
console.log(`  TYPICAL_PROMPT_TOKENS = ${Math.round(allPrompt / allCalls / 100) * 100}`);
console.log(`  TYPICAL_ITERATIONS    = ${mean(runs.map((r) => r.iterations))}`);
console.log(
  `\nmaxTokens: самый длинный ответ за все прогоны — ${maxCompletion} токенов.` +
    `\n  Безопасный потолок с запасом ×2: ${Math.ceil((maxCompletion * 2) / 512) * 512}.`,
);
