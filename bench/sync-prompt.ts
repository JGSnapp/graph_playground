/**
 * Copies the current DEFAULT_SYSTEM_PROMPT into a settings file and drops the
 * cached skills so the seeds are re-read. The prompt lives in settings, so a
 * code change does not reach a running install by itself.
 *
 *   tsx bench/sync-prompt.ts bench/data     (default)
 *   tsx bench/sync-prompt.ts data           (the live install)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SYSTEM_PROMPT } from '../server/src/modules/settings/defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', process.argv[2] ?? 'bench/data');
const file = path.join(dir, 'settings.json');

if (!fs.existsSync(file)) {
  console.error(`нет файла ${file}`);
  process.exit(1);
}
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
const changed = settings.agent.systemPrompt !== DEFAULT_SYSTEM_PROMPT;
settings.agent.systemPrompt = DEFAULT_SYSTEM_PROMPT;
fs.writeFileSync(file, JSON.stringify(settings, null, 2));

const skillsFile = path.join(dir, 'skills.json');
if (fs.existsSync(skillsFile)) {
  fs.rmSync(skillsFile);
  console.log(`skills.json удалён — встроенные скиллы пересеются при старте`);
}
console.log(changed ? `промпт обновлён в ${file}` : `промпт уже актуален в ${file}`);

// maxTokens is not touched automatically: it is a cost decision, not a default.
if (settings.agent.maxTokens > 4096) {
  console.log(
    `\nВнимание: agent.maxTokens = ${settings.agent.maxTokens}. Шлюз резервирует деньги по этому\n` +
      `числу, а не по факту использования. Новый рекомендуемый потолок — 4096. Поменять можно\n` +
      `в настройках агента.`,
  );
}
