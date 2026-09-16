/**
 * Builds the data directory for one arm of the placement experiment.
 *
 *   tsx bench/setup-arm.ts manual
 *   tsx bench/setup-arm.ts choice
 *
 * Same provider, same key, same limits as the automatic arm — only the system
 * prompt differs, and TECA_LAYOUT_MODE at server start picks the matching skill
 * and decides whether `board_arrange_graph` is offered.
 */
import { CHOICE_SYSTEM_PROMPT, MANUAL_SYSTEM_PROMPT } from '../server/src/modules/settings/defaults.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const prompts: Record<string, string> = { manual: MANUAL_SYSTEM_PROMPT, choice: CHOICE_SYSTEM_PROMPT };
if (!prompts[mode]) {
  console.error('нужен режим: manual или choice');
  process.exit(2);
}

const dir = path.join(here, `data-${mode}`);
fs.mkdirSync(dir, { recursive: true });
const settings = JSON.parse(fs.readFileSync(path.join(here, 'data', 'settings.json'), 'utf8'));
settings.agent.systemPrompt = prompts[mode];
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));

// A stale skills file would keep another arm's skill under the same slug.
for (const stale of ['skills.json', 'boards.json', 'chats.json', 'runs.json']) {
  const p = path.join(dir, stale);
  if (fs.existsSync(p)) fs.rmSync(p);
}

console.log(`каталог: ${dir}`);
console.log(`промпт: ${prompts[mode].length} симв, модель ${settings.provider.defaultModel}`);
