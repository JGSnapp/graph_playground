/**
 * Builds the data directory for the manual-placement arm of the experiment.
 *
 * Same provider, same key, same limits as the automatic arm — only the system
 * prompt differs, and `TECA_MANUAL_LAYOUT=1` at server start swaps the skill and
 * hides `board_arrange_graph`.
 */
import { MANUAL_SYSTEM_PROMPT } from '../server/src/modules/settings/defaults.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, 'data', 'settings.json');
const dir = path.join(here, 'data-manual');
fs.mkdirSync(dir, { recursive: true });

const settings = JSON.parse(fs.readFileSync(from, 'utf8'));
settings.agent.systemPrompt = MANUAL_SYSTEM_PROMPT;
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));

// A stale skills file would keep the automatic skill under the same slug.
for (const stale of ['skills.json', 'boards.json', 'chats.json', 'runs.json']) {
  const p = path.join(dir, stale);
  if (fs.existsSync(p)) fs.rmSync(p);
}

console.log(`каталог: ${dir}`);
console.log(`промпт: ${MANUAL_SYSTEM_PROMPT.length} симв, модель ${settings.provider.defaultModel}`);
console.log(`итераций ${settings.agent.maxIterations}, maxTokens ${settings.agent.maxTokens}, ключ задан: ${String(settings.provider.apiKey).length > 0}`);
