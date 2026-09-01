import { arrangeGraph, boardQuality, type ArrangeOptions } from '@teca/shared';
import { applyRoute } from '../../boards/operations.js';
import { bool, enumOf, int, num, objectSchema, str, type ToolSpec } from './types.js';

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? (value as unknown[]).filter((item): item is string => typeof item === 'string') : [];

/**
 * Placement, not routing, decides how many arrows cross. Measurements on real
 * boards: 12 arrows over 11 hand-placed nodes gave 50 crossings, and no routing
 * parameter moved that number; the same graph laid out in layers gave 0.
 */
export const boardArrangeGraph: ToolSpec = {
  name: 'board_arrange_graph',
  description:
    'Раскладывает уже созданные артефакты как граф: разносит их по слоям вдоль потока, ' +
    'подбирает порядок внутри слоя так, чтобы стрелки почти не пересекались, ' +
    'и сразу прокладывает стрелки. Пересечения решаются порядком узлов в слое, ' +
    'а не изгибами, поэтому это делается расстановкой, а не роутером. ' +
    'Вызывай после того, как все узлы и стрелки созданы. Артефакты не создаются и не удаляются — ' +
    'только двигаются. Направление auto пробует и слева-направо, и сверху-вниз, и оставляет то, ' +
    'что дало лучшую оценку. Узлы, которые двигать нельзя, перечисли в lockIds. ' +
    'Результат можно после этого править руками обычными artifact_move / arrow_create.',
  parameters: objectSchema({
    nodeIds: {
      type: 'array',
      description:
        'Какие артефакты раскладывать. Без него — все артефакты доски. Перечисленные вне списка не двигаются, и композиция отодвигается от них.',
      items: { type: 'string' },
    },
    direction: enumOf(
      ['auto', 'LR', 'TB', 'RL', 'BT'],
      'Направление потока: LR слева направо, TB сверху вниз, auto — выбрать лучшее по оценке (по умолчанию auto)',
    ),
    groups: {
      type: 'array',
      description:
        'Смысловые группы: узлы одной группы держатся рядом внутри слоя. Задавай их, если у схемы есть подсистемы.',
      items: {
        type: 'object',
        properties: {
          id: str('Имя группы'),
          nodeIds: { type: 'array', description: 'Артефакты группы', items: { type: 'string' } },
        },
        required: ['id', 'nodeIds'],
        additionalProperties: false,
      },
    },
    lockIds: {
      type: 'array',
      description: 'Артефакты, которые обязаны остаться на своих координатах; композиция строится относительно них.',
      items: { type: 'string' },
    },
    nodeSpacing: int('Воздух между соседями внутри слоя, по умолчанию 80px'),
    layerSpacing: int('Расстояние между слоями, по умолчанию 220px'),
    groupSpacing: int('Дополнительный воздух между разными группами, по умолчанию 170px'),
    originX: num('Левый край композиции. Без origin композиция остаётся примерно на месте.'),
    originY: num('Верхний край композиции'),
    dryRun: bool('true — только посчитать и вернуть отчёт, доску не менять'),
  }),
  run: (args, ctx) => {
    const options: ArrangeOptions = {
      nodeIds: stringList(args.nodeIds),
      lockIds: stringList(args.lockIds),
      direction: (args.direction as ArrangeOptions['direction']) ?? 'auto',
      spacing: {
        node: typeof args.nodeSpacing === 'number' ? args.nodeSpacing : undefined,
        layer: typeof args.layerSpacing === 'number' ? args.layerSpacing : undefined,
        group: typeof args.groupSpacing === 'number' ? args.groupSpacing : undefined,
      },
      groups: Array.isArray(args.groups)
        ? (args.groups as unknown[])
            .map((item) => {
              if (!item || typeof item !== 'object') return null;
              const row = item as Record<string, unknown>;
              if (typeof row.id !== 'string') return null;
              return { id: row.id, nodeIds: stringList(row.nodeIds) };
            })
            .filter((item): item is { id: string; nodeIds: string[] } => item != null)
        : undefined,
      origin:
        typeof args.originX === 'number' && typeof args.originY === 'number'
          ? { x: args.originX, y: args.originY }
          : undefined,
    };

    const preview = ctx.boards.read(ctx.boardId, (state) => {
      if (state.arrows.length === 0) return null;
      return arrangeGraph(state.artifacts, state.arrows, options);
    });

    if (!preview) {
      return {
        data: {
          refused: true,
          reason:
            'На доске нет стрелок — раскладывать нечего. Этот тул расставляет связный граф; для набора карточек используй скилл artifact-set и обычный artifact_create.',
        },
        mutated: false,
      };
    }

    const report = {
      direction: preview.chosen.direction,
      spacingScale: preview.chosen.spacingScale,
      layers: preview.layout.layers.length,
      layerSizes: preview.layout.layers.map((layer) => layer.length),
      crossings: preview.layout.crossings,
      crossingsBefore: preview.layout.crossingsBefore,
      reversedEdges: preview.layout.reversedEdges.length,
      moved: preview.layout.nodes.length,
      bounds: preview.layout.bounds,
      qualityBefore: preview.qualityBefore,
      qualityAfter: preview.qualityAfter,
      candidates: preview.candidates,
    };

    if (args.dryRun === true) {
      return {
        data: {
          ...report,
          applied: false,
          verdict: `Расчёт: ${preview.qualityBefore.score} → ${preview.qualityAfter.score}/100. Доска не менялась, вызови без dryRun чтобы применить.`,
        },
        mutated: false,
      };
    }

    ctx.boards.mutate(ctx.boardId, (state) => {
      const at = new Map(preview.artifacts.map((item) => [item.id, item]));
      for (const artifact of state.artifacts) {
        const next = at.get(artifact.id);
        if (!next || (next.x === artifact.x && next.y === artifact.y)) continue;
        artifact.x = next.x;
        artifact.y = next.y;
        artifact.updatedAt = Date.now();
      }
      for (const routed of preview.arrows) {
        applyRoute(state, routed.id, {
          bends: routed.bends,
          fromSide: routed.from.side === 'auto' ? 'right' : routed.from.side,
          toSide: routed.to.side === 'auto' ? 'left' : routed.to.side,
          fromOffset: routed.from.offset ?? 0.5,
          toOffset: routed.to.offset ?? 0.5,
        });
      }
      return null;
    });

    const after = ctx.boards.read(ctx.boardId, (state) => boardQuality(state.artifacts, state.arrows));
    ctx.boards.rememberQuality(ctx.boardId, after.cost);

    return {
      data: {
        ...report,
        applied: true,
        qualityAfter: { score: after.score, cost: after.cost, grade: after.grade },
        hints: after.hints,
        verdict:
          after.counts.arrowArtifact === 0 && after.counts.artifactArtifact === 0
            ? `Граф разложен по слоям (${report.direction}): ${report.layers} слоёв, пересечений рёбер ${report.crossings}. Оценка ${preview.qualityBefore.score} → ${after.score}/100. Дальше правь точечно, всю раскладку заново не пересобирай.`
            : `Разложено, но конфликты остались: ${JSON.stringify(after.counts)}. Проверь board_check_intersections и правь точечно.`,
      },
      mutated: true,
    };
  },
};

export const arrangeTools: ToolSpec[] = [boardArrangeGraph];
