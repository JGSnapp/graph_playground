/** Prints the frozen task pool. */
import { TASKS } from './tasks.js';
console.log(`задач в пуле: ${TASKS.length}`);
for (const task of TASKS) {
  console.log(`  ${task.id.padEnd(18)} ${task.graph ? 'граф ' : 'набор'} ${task.probes}`);
}
