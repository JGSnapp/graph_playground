/**
 * Cost guardrails for the bench.
 *
 * The gateway does not charge by what a request used — it *reserves* by what a
 * request could use: prompt tokens plus `max_tokens`. That is why a single
 * `claude-sonnet-5` iteration with `max_tokens: 8192` reserved about 10 units
 * while the same task on `deepseek-v4-flash` reserved 0.22, and why six of them
 * in parallel emptied the account: the reserve is held against the whole
 * balance, so it blocks the cheap runs too.
 *
 * The rates below are read off the gateway's own `Estimated request cost`
 * messages, so they are DS Lab's numbers rather than a guess at list prices.
 * They are used only to refuse a run that would blow the budget, never to
 * report what something actually cost — that comes from the token usage the
 * provider reports, which the run log records.
 */

/**
 * The gateway never states a currency. Derived from its own estimates against
 * published list prices, on three models that disagree about price by two
 * orders of magnitude:
 *
 *   deepseek-v4-flash  18 units / 1M output tokens   at ≈ $0.30 / 1M  → ≈ 60/$
 *   claude-sonnet-5  1000 units / 1M output tokens   at ≈ $15   / 1M  → ≈ 67/$
 *   gemini-3.6-flash  750 units / 1M output tokens   at ≈ $10   / 1M  → ≈ 75/$
 *
 * All three land in the same narrow band, so the unit is roubles (or a credit
 * pegged near that rate) — not dollars. Used only to print a familiar figure
 * next to the raw estimate; every threshold in this file is in gateway units.
 */
export const UNITS_PER_USD = 65;

export const inDollars = (units: number): string => `$${(units / UNITS_PER_USD).toFixed(3)}`;

export type ModelTier = 'cheap' | 'expensive';

interface Rates {
  tier: ModelTier;
  /** Reserved units per 1000 prompt tokens. */
  perKPrompt: number;
  /** Reserved units per 1000 tokens of `max_tokens`. */
  perKCompletion: number;
}

/** Matched longest-prefix-first, so a family entry covers new members. */
const RATES: Array<[string, Rates]> = [
  ['deepseek-v4-flash', { tier: 'cheap', perKPrompt: 0.011, perKCompletion: 0.018 }],
  ['deepseek-v4-pro', { tier: 'cheap', perKPrompt: 0.03, perKCompletion: 0.05 }],
  ['deepseek', { tier: 'cheap', perKPrompt: 0.011, perKCompletion: 0.018 }],
  ['claude-haiku', { tier: 'cheap', perKPrompt: 0.05, perKCompletion: 0.09 }],
  ['gemini-3.6-flash', { tier: 'expensive', perKPrompt: 0.25, perKCompletion: 0.75 }],
  ['gpt-5.6', { tier: 'expensive', perKPrompt: 0.37, perKCompletion: 1.0 }],
  ['claude-sonnet-5', { tier: 'expensive', perKPrompt: 0.37, perKCompletion: 1.0 }],
  ['claude-opus', { tier: 'expensive', perKPrompt: 0.9, perKCompletion: 2.5 }],
  ['claude', { tier: 'expensive', perKPrompt: 0.37, perKCompletion: 1.0 }],
  ['gpt', { tier: 'expensive', perKPrompt: 0.37, perKCompletion: 1.0 }],
  ['gemini', { tier: 'expensive', perKPrompt: 0.25, perKCompletion: 0.75 }],
];

/** Unknown models are assumed expensive: a wrong guess must fail safe. */
const FALLBACK: Rates = { tier: 'expensive', perKPrompt: 0.37, perKCompletion: 1.0 };

export const ratesFor = (model: string): Rates => {
  const id = model.toLowerCase();
  const hit = RATES.filter(([prefix]) => id.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return hit ? hit[1] : FALLBACK;
};

export const tierOf = (model: string): ModelTier => ratesFor(model).tier;

/**
 * Prompt size of an average agent iteration: system prompt, tool schemas, board
 * state and the growing tool-result history. Measured over the E02 pool
 * (`bench/calibrate.ts`): the first iteration carries about 8 800 tokens and the
 * last about 23 000, averaging 23 100 across all calls.
 *
 * Note this is the size the gateway *reserves* against. What it actually bills
 * is far less: 95% of these prompt tokens came back marked as cache reads.
 */
export const TYPICAL_PROMPT_TOKENS = 23100;

export const reservationPerIteration = (model: string, maxTokens: number): number => {
  const rates = ratesFor(model);
  return (
    (TYPICAL_PROMPT_TOKENS / 1000) * rates.perKPrompt + (maxTokens / 1000) * rates.perKCompletion
  );
};

/** Largest `max_tokens` that keeps one iteration inside `budget`, or null. */
export const maxTokensWithin = (model: string, budget: number): number | null => {
  const rates = ratesFor(model);
  const promptPart = (TYPICAL_PROMPT_TOKENS / 1000) * rates.perKPrompt;
  if (promptPart >= budget) return null;
  const room = ((budget - promptPart) / rates.perKCompletion) * 1000;
  return Math.floor(room / 256) * 256;
};

/**
 * Iterations one board takes. Measured over the E02 pool on
 * `deepseek-v4-flash`: 4 for a plain card set, 8-20 for a graph, 50 when the
 * agent fell into a rebuild loop. The cheap model loops far more than a strong
 * one, so it is not as cheap per board as its per-call rate suggests.
 */
export const TYPICAL_ITERATIONS = 17;

export interface RunEstimate {
  model: string;
  tier: ModelTier;
  perIteration: number;
  perRun: number;
  iterations: number;
}

export const estimateRun = (
  model: string,
  maxTokens: number,
  iterations = TYPICAL_ITERATIONS,
): RunEstimate => {
  const perIteration = reservationPerIteration(model, maxTokens);
  return {
    model,
    tier: tierOf(model),
    perIteration,
    perRun: perIteration * iterations,
    iterations,
  };
};

export interface BudgetVerdict {
  ok: boolean;
  perRun: number;
  total: number;
  lines: string[];
  problem?: string;
  suggestedMaxTokens?: number | null;
}

/**
 * Budgets are per board and per experiment, not per request. A single call is
 * never the thing anyone cares about — a board takes a dozen of them, and an
 * experiment takes dozens of boards.
 */
export const checkExperimentBudget = (args: {
  models: string[];
  runs: number;
  maxTokens: number;
  budgetRun: number;
  budgetExperiment: number;
  iterations?: number;
}): BudgetVerdict => {
  const { models, runs, maxTokens, budgetRun, budgetExperiment } = args;
  const estimates = models.map((model) => estimateRun(model, maxTokens, args.iterations));
  const runsPerModel = runs / Math.max(1, models.length);
  const total = estimates.reduce((sum, item) => sum + item.perRun * runsPerModel, 0);

  const lines = estimates.map(
    (item) =>
      `  ${item.model.padEnd(20)} ≈ ${item.perIteration.toFixed(2)} за итерацию, ` +
      `≈ ${item.perRun.toFixed(0)} за доску (${item.iterations} итер) ≈ ${inDollars(item.perRun)}`,
  );
  lines.push(
    `  весь эксперимент: ${runs} прогонов ≈ ${total.toFixed(0)} единиц ≈ ${inDollars(total)}`,
  );

  const worst = estimates.reduce((a, b) => (a.perRun > b.perRun ? a : b));
  if (worst.perRun > budgetRun) {
    const fit = maxTokensWithin(worst.model, budgetRun / worst.iterations);
    return {
      ok: false,
      perRun: worst.perRun,
      total,
      lines,
      suggestedMaxTokens: fit,
      problem:
        `Одна доска на ${worst.model} резервирует ≈ ${worst.perRun.toFixed(0)} (${inDollars(worst.perRun)}), ` +
        `лимит на доску ${budgetRun}.\n` +
        (fit != null
          ? `Уложится при --maxTokens=${fit}, либо подними --budget-run.`
          : `В этот лимит модель не влезет ни при каком maxTokens — возьми модель дешевле.`),
    };
  }
  if (total > budgetExperiment) {
    return {
      ok: false,
      perRun: worst.perRun,
      total,
      lines,
      problem:
        `Весь эксперимент резервирует ≈ ${total.toFixed(0)} (${inDollars(total)}), ` +
        `лимит ${budgetExperiment} (${inDollars(budgetExperiment)}).\n` +
        `Сократи число задач или моделей, либо подними --budget-exp.`,
    };
  }
  return { ok: true, perRun: worst.perRun, total, lines };
};

/**
 * Parallelism policy. Two streams are the ceiling and only cheap models get
 * them: a parallel expensive run is what drained the account, and the reserve
 * is held against the whole balance, so it also blocks the cheap runs.
 */
export const concurrencyFor = (models: string[], requested: number): { value: number; note: string } => {
  const anyExpensive = models.some((model) => tierOf(model) === 'expensive');
  const ceiling = anyExpensive ? 1 : 2;
  const value = Math.max(1, Math.min(requested, ceiling));
  if (value === requested) return { value, note: '' };
  return {
    value,
    note: anyExpensive
      ? `Параллельность снижена с ${requested} до 1: в наборе есть дорогая модель (${models.filter((m) => tierOf(m) === 'expensive').join(', ')}).`
      : `Параллельность снижена с ${requested} до 2 — это потолок стенда.`,
  };
};
