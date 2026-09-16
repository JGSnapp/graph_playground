/** Which tools each arm of the experiment offers. */
import { ToolRegistry } from '../server/src/modules/agent/tools/index.js';
import { defaultSettings } from '../server/src/modules/settings/defaults.js';

const list = () =>
  new ToolRegistry()
    .definitions(defaultSettings())
    .map((d) => d.function.name)
    .sort();

delete process.env.TECA_MANUAL_LAYOUT;
const auto = list();
process.env.TECA_MANUAL_LAYOUT = '1';
const manual = list();

console.log(`автоматический режим: ${auto.length} инструментов`);
console.log(`ручной режим:         ${manual.length} инструментов`);
console.log(`разница: ${auto.filter((n) => !manual.includes(n)).join(', ') || 'нет'}`);
