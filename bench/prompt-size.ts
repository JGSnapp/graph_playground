/**
 * Local size of one agent request: system prompt + tool schemas. No network.
 *
 * Tool schemas are the fixed part of every single call, so they are paid for on
 * every iteration. This prints where those characters actually go.
 */
import { ToolRegistry } from '../server/src/modules/agent/tools/index.js';
import { defaultSettings } from '../server/src/modules/settings/defaults.js';

const settings = defaultSettings();
const tools = new ToolRegistry().definitions(settings);
const prompt = settings.agent.systemPrompt;

/** Mixed Russian prose plus JSON: about 3 characters per token on this family. */
const toTokens = (chars: number): number => Math.round(chars / 3);

const rows = tools
  .map((tool) => {
    const whole = JSON.stringify(tool).length;
    const description = tool.function.description.length;
    const params = JSON.stringify(tool.function.parameters).length;
    return { name: tool.function.name, whole, description, params };
  })
  .sort((a, b) => b.whole - a.whole);

const toolsTotal = rows.reduce((sum, row) => sum + row.whole, 0);
const descTotal = rows.reduce((sum, row) => sum + row.description, 0);
const paramsTotal = rows.reduce((sum, row) => sum + row.params, 0);

console.log('инструмент'.padEnd(28), 'всего'.padStart(7), 'описание'.padStart(9), 'параметры'.padStart(10), 'токенов'.padStart(8));
console.log('-'.repeat(66));
for (const row of rows) {
  console.log(
    row.name.padEnd(28),
    String(row.whole).padStart(7),
    String(row.description).padStart(9),
    String(row.params).padStart(10),
    String(toTokens(row.whole)).padStart(8),
  );
}
console.log('-'.repeat(66));
console.log(
  'ИТОГО схемы'.padEnd(28),
  String(toolsTotal).padStart(7),
  String(descTotal).padStart(9),
  String(paramsTotal).padStart(10),
  String(toTokens(toolsTotal)).padStart(8),
);
console.log(
  'системный промпт'.padEnd(28),
  String(prompt.length).padStart(7),
  ''.padStart(9),
  ''.padStart(10),
  String(toTokens(prompt.length)).padStart(8),
);
console.log(
  'ФИКСИРОВАННАЯ ЧАСТЬ'.padEnd(28),
  String(toolsTotal + prompt.length).padStart(7),
  ''.padStart(9),
  ''.padStart(10),
  String(toTokens(toolsTotal + prompt.length)).padStart(8),
);

console.log(`\nДоля схем в фиксированной части: ${Math.round((toolsTotal / (toolsTotal + prompt.length)) * 100)}%`);
console.log(`Из них описания: ${Math.round((descTotal / toolsTotal) * 100)}%, схемы параметров: ${Math.round((paramsTotal / toolsTotal) * 100)}%`);

// What each group costs, to see which whole families are worth hiding.
const groups: Array<[string, RegExp]> = [
  ['стрелки (arrow_*)', /^arrow_/],
  ['  из них изгибы (arrow_bend_*)', /^arrow_bend_/],
  ['артефакты (artifact_*)', /^artifact_/],
  ['восприятие (board_get/screenshot/check)', /^board_(get|screenshot|check)/],
  ['раскладка (board_arrange/route/clean/quality)', /^board_(arrange|route|clean|quality)/],
  ['скиллы (skill_*)', /^skill_/],
  ['база знаний (kb_*)', /^kb_/],
];
console.log('\nПо группам:');
for (const [label, pattern] of groups) {
  const hit = rows.filter((row) => pattern.test(row.name));
  if (hit.length === 0) continue;
  const chars = hit.reduce((sum, row) => sum + row.whole, 0);
  console.log(
    `  ${label.padEnd(44)} ${String(hit.length).padStart(2)} шт  ${String(chars).padStart(6)} симв  ` +
      `~${String(toTokens(chars)).padStart(5)} ток  ${String(Math.round((chars / toolsTotal) * 100)).padStart(2)}%`,
  );
}

/** Sum of every `description` string nested anywhere inside a schema. */
const descChars = (node: unknown): number => {
  if (Array.isArray(node)) return node.reduce<number>((s, item) => s + descChars(item), 0);
  if (!node || typeof node !== 'object') return 0;
  let total = 0;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'description' && typeof value === 'string') total += value.length;
    else total += descChars(value);
  }
  return total;
};

let paramsTotalNested = 0;
let fieldDocs = 0;
const fatRows = tools.map((tool) => {
  const params = JSON.stringify(tool.function.parameters).length;
  const docs = descChars(tool.function.parameters);
  paramsTotalNested += params;
  fieldDocs += docs;
  return { name: tool.function.name, params, docs, structure: params - docs };
});

fatRows.sort((a, b) => b.docs - a.docs);
console.log('инструмент'.padEnd(28), 'параметры'.padStart(10), 'из них текст'.padStart(13), 'структура'.padStart(10));
for (const row of fatRows.slice(0, 10)) {
  console.log(row.name.padEnd(28), String(row.params).padStart(10), String(row.docs).padStart(13), String(row.structure).padStart(10));
}
console.log('-'.repeat(64));
console.log(
  `все параметры: ${paramsTotalNested} симв, из них описания полей ${fieldDocs} (${Math.round((fieldDocs / paramsTotalNested) * 100)}%)`,
);

const schemaTotal = tools.reduce((s, t) => s + JSON.stringify(t).length, 0);
const topDescs = tools.reduce((s, t) => s + t.function.description.length, 0);
console.log(`\nвесь текст в схемах: ${topDescs + fieldDocs} из ${schemaTotal} симв (${Math.round(((topDescs + fieldDocs) / schemaTotal) * 100)}%)`);

// What a few concrete cuts would save.
const size = (predicate: (name: string) => boolean): number =>
  tools.filter((t) => predicate(t.function.name)).reduce((s, t) => s + JSON.stringify(t).length, 0);

const scenarios: Array<[string, number]> = [
  ['убрать arrow_bend_add/move/remove', size((n) => n.startsWith('arrow_bend_'))],
  ['убрать kb_search/kb_add', size((n) => n.startsWith('kb_'))],
  ['убрать тюнинг-параметры роутера', 380],
  ['ужать все тексты вдвое', Math.round((topDescs + fieldDocs) / 2)],
];
console.log('\nСколько сэкономит:');
let running = schemaTotal;
for (const [label, saved] of scenarios) {
  running -= saved;
  console.log(
    `  ${label.padEnd(36)} −${String(saved).padStart(5)} симв  (~${Math.round(saved / 3)} ток)`,
  );
}
console.log(`  ${'все вместе'.padEnd(36)} схемы ${schemaTotal} → ${running} симв (~${Math.round(running / 3)} ток)`);
