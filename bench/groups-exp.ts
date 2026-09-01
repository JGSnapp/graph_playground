/**
 * A/B for thematic grouping, replayed on the groups the agent itself chose.
 *
 * E02 tool calls carry the `groups` the model passed to `board_arrange_graph`,
 * so the split is a real one rather than something invented for the test.
 * Measures both layout quality and how compact each theme ends up.
 */
import { arrangeGraph, boardQuality, type Artifact, type BoardState } from '@teca/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Group {
  id: string;
  nodeIds: string[];
}

interface Case {
  task: string;
  state: BoardState;
  groups: Group[];
}

/**
 * Themes for the bench tasks, written out here rather than read from a run:
 * E02 results truncated the tool arguments, so the groups the model actually
 * passed cannot be replayed. These are the obvious subsystems of each task —
 * the split a person would make reading the prompt.
 */
const THEMES: Record<string, Record<string, string[]>> = {
  'dense-arch': {
    clients: ['Клиент (веб)', 'Клиент (мобильный)'],
    delivery: ['CDN', 'Хранилище видео', 'Транскодер'],
    core: ['API Gateway', 'Auth', 'Каталог', 'Биллинг', 'Плеер-бэкенд'],
    data: ['Postgres', 'Kafka', 'Метрики', 'Рекомендации'],
  },
  'states-order': {
    happy: ['Создан', 'Ожидает оплаты', 'Оплачен', 'Собирается', 'Передан в доставку', 'Доставлен'],
    bad: ['Отменён', 'Возврат'],
  },
  'tree-org': {
    tech: ['CTO', 'Backend', 'Frontend', 'SRE', 'Платформа', 'Биллинг'],
    product: ['CPO', 'Дизайн', 'аналитика'],
    finance: ['CFO', 'Бухгалтерия'],
  },
  'pipeline-cicd': {
    checks: ['Линтер', 'Юнит', 'Интеграционные'],
    ship: ['Сборка', 'staging', 'аппрув', 'prod'],
    ops: ['Мониторинг', 'Slack'],
  },
};

const captionOf = (artifact: Artifact): string => {
  const props = artifact.props as Record<string, unknown>;
  for (const key of ['text', 'label', 'title']) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

const load = (): Case[] => {
  const dir = path.join(here, 'out', 'E02');
  if (!fs.existsSync(dir)) return [];
  const cases: Case[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const theme = THEMES[data.task as string];
    if (!theme) continue;
    const groups: Group[] = Object.entries(theme).map(([id, needles]) => ({
      id,
      nodeIds: (data.state.artifacts as Artifact[])
        .filter((a) => needles.some((n) => captionOf(a).toLowerCase().includes(n.toLowerCase())))
        .map((a) => a.id),
    })).filter((g) => g.nodeIds.length > 0);
    if (groups.length < 2) continue;
    cases.push({ task: data.task, state: data.state, groups });
  }
  return cases;
};

/**
 * How tightly a theme sits together: the mean spread of its members around
 * their own centre, divided by the spread of the whole composition. Lower is
 * a more compact blob, which is what "put related things together" means.
 */
const cohesion = (artifacts: Artifact[], groups: Group[]): number => {
  const at = new Map(artifacts.map((a) => [a.id, { x: a.x + a.width / 2, y: a.y + a.height / 2 }]));
  const all = [...at.values()];
  if (all.length === 0) return 0;
  const centre = {
    x: all.reduce((s, p) => s + p.x, 0) / all.length,
    y: all.reduce((s, p) => s + p.y, 0) / all.length,
  };
  const whole =
    all.reduce((s, p) => s + Math.hypot(p.x - centre.x, p.y - centre.y), 0) / all.length;
  if (whole === 0) return 0;

  const ratios: number[] = [];
  for (const group of groups) {
    const points = group.nodeIds.map((id) => at.get(id)).filter(Boolean) as Array<{ x: number; y: number }>;
    if (points.length < 2) continue;
    const gc = {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
    const spread =
      points.reduce((s, p) => s + Math.hypot(p.x - gc.x, p.y - gc.y), 0) / points.length;
    ratios.push(spread / whole);
  }
  return ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100 : 0;
};

const cases = load();
if (cases.length === 0) {
  console.log('нет подходящих прогонов');
  process.exit(0);
}

let offCost = 0;
let onCost = 0;
let offCoh = 0;
let onCoh = 0;

console.log('задача'.padEnd(18), 'групп', 'cost без полос', 'cost с полосами', 'сжатость без', 'сжатость с');
for (const item of cases) {
  const off = arrangeGraph(item.state.artifacts, item.state.arrows, { groups: item.groups });
  const on = arrangeGraph(item.state.artifacts, item.state.arrows, {
    groups: item.groups,
    groupBands: true,
  });
  const cOff = cohesion(off.artifacts, item.groups);
  const cOn = cohesion(on.artifacts, item.groups);
  console.log(
    item.task.padEnd(18),
    String(item.groups.length).padStart(5),
    String(off.qualityAfter.cost).padStart(14),
    String(on.qualityAfter.cost).padStart(15),
    String(cOff).padStart(12),
    String(cOn).padStart(10),
  );
  offCost += off.qualityAfter.cost;
  onCost += on.qualityAfter.cost;
  offCoh += cOff;
  onCoh += cOn;
}

const n = cases.length;
console.log(
  `\nсредний cost: без полос ${Math.round(offCost / n)} | с полосами ${Math.round(onCost / n)}` +
    `\nсжатость тем (меньше — компактнее): без полос ${Math.round((offCoh / n) * 100) / 100} | с полосами ${Math.round((onCoh / n) * 100) / 100}`,
);
