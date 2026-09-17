import { boardQuality, cleanArrowRoutes, routeArrows, searchPorts, tooTightToRoute } from '@teca/shared';
import { applyRoute } from '../../boards/operations.js';
import { int, num, objectSchema, str, type ToolSpec } from './types.js';

export const boardRouteArrows: ToolSpec = {
  name: 'board_route_arrows',
  description:
    'Прокладывает стрелки ортогонально в обход артефактов и чужих линий. Вызывай один раз, когда узлы и стороны финальные. Плотный ряд роутеру не мешает: он отказывает, только если у блока закрыты все четыре стороны. Крюк в ответе — предупреждение: чини стороны или тесноту, а не добавляй изгибы. Без arrowIds перекладывает все стрелки.',
  parameters: objectSchema({
    arrowIds: {
      type: 'array',
      description: 'Какие стрелки переложить. Без него — все стрелки доски.',
      items: { type: 'string' },
    },
    margin: int('Ширина коридора вокруг артефактов, по умолчанию 24px'),
    clearance: int('Минимальный зазор от стрелки до артефакта, по умолчанию 8px'),
    turnPenalty: num('Штраф за поворот: больше — меньше изгибов, по умолчанию 120'),
    overlapPenalty: num(
      'Штраф за пиксель хода вплотную к чужой стрелке, по умолчанию 2. Выше 4 роутер начинает делать петли ради обхода.',
    ),
    crossPenalty: num('Штраф за пересечение чужой стрелки, по умолчанию 80'),
  }),
  run: (args, ctx) => {
    const ids = Array.isArray(args.arrowIds)
      ? (args.arrowIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;

    const before = ctx.boards.read(ctx.boardId, (state) => ({
      quality: boardQuality(state.artifacts, state.arrows),
      gate: tooTightToRoute(state.artifacts, state.arrows, ids),
    }));

    if (!before.gate.ready) {
      return {
        data: {
          routed: [],
          skipped: [],
          refused: true,
          crowded: before.gate.crowded,
          overlapping: before.gate.overlapping,
          qualityBefore: { score: before.quality.score, cost: before.quality.cost },
          warnings: [before.gate.note],
          verdict: before.gate.note,
        },
        mutated: false,
      };
    }

    const outcome = ctx.boards.mutate(ctx.boardId, (state) => {
      // Which side and which point of a node an arrow takes is decided once per
      // arrow. Trying other attachment orders for the arrows that meet at one
      // node removes about a third of the crossings the search leaves behind.
      const withPorts = (arrows: typeof state.arrows, detour: boolean) =>
        searchPorts(state.artifacts, arrows, {
          detour,
          lockedArrowIds: arrows.filter((arrow) => !arrow.autoPorts).map((arrow) => arrow.id),
        });

      // Four candidates, two questions.
      //
      // Re-lay or keep: a re-route is a proposal, not always an improvement. It
      // discards the attachments the agent chose, and the port search then has
      // to climb out of whatever basin the fresh routing landed in. On
      // `fix-broken` that costs nine points — the untouched board finds the
      // route round the bottom (96) where the re-laid one loops over the top.
      //
      // Detour or not: the detour pass reaches routes the one-at-a-time moves
      // cannot, but an early detour can block a better swap later. Measured
      // over 30 boards it wins on 6 and loses on 4 — all four losses under a
      // point, but there is no reason to take them when both answers are a few
      // seconds apart. Running the four and keeping the best cannot lose.
      const snapshot = state.arrows.map((arrow) => ({ ...arrow }));
      const candidates = [withPorts(snapshot, true)];
      if (before.quality.counts.arrowArrow > 0) candidates.push(withPorts(snapshot, false));

      const result = routeArrows(state.artifacts, state.arrows, {
        arrowIds: ids,
        margin: typeof args.margin === 'number' ? args.margin : undefined,
        clearance: typeof args.clearance === 'number' ? args.clearance : undefined,
        turnPenalty: typeof args.turnPenalty === 'number' ? args.turnPenalty : undefined,
        overlapPenalty:
          typeof args.overlapPenalty === 'number' ? args.overlapPenalty : undefined,
        crossPenalty: typeof args.crossPenalty === 'number' ? args.crossPenalty : undefined,
      });
      for (const routed of result.routed) applyRoute(state, routed.arrowId, routed);

      const relaid = state.arrows.map((arrow) => ({ ...arrow }));
      const relaidQuality = boardQuality(state.artifacts, relaid);
      candidates.push(withPorts(relaid, true));
      if (relaidQuality.counts.arrowArrow > 0) candidates.push(withPorts(relaid, false));

      // The freshly routed board is itself in the running: if no search beats
      // it, it stays as the router drew it.
      let winner: (typeof candidates)[number] | null = null;
      let winningCost = relaidQuality.cost;
      for (const candidate of candidates) {
        if (candidate.costAfter >= winningCost) continue;
        winner = candidate;
        winningCost = candidate.costAfter;
      }
      if (winner) {
        for (const arrow of winner.arrows) {
          const target = state.arrows.find((item) => item.id === arrow.id);
          if (!target) continue;
          target.bends = arrow.bends;
          target.from = arrow.from;
          target.to = arrow.to;
          target.autoPorts = true;
          target.updatedAt = Date.now();
        }
      }
      return { ...result, portSwaps: winner?.swaps ?? 0 };
    });

    const after = ctx.boards.read(ctx.boardId, (state) =>
      boardQuality(state.artifacts, state.arrows),
    );
    ctx.boards.rememberQuality(ctx.boardId, after.cost);

    const delta = Math.round((before.quality.cost - after.cost) * 10) / 10;
    const hooks = outcome.routed.filter((r) => r.hook);
    const warnings: string[] = [];
    if (hooks.length > 0) {
      const idsList = hooks.map((r) => r.arrowId).join(', ');
      const worst = Math.max(...hooks.map((r) => r.detourRatio ?? 1));
      warnings.push(
        `Проблема: стрелки ${idsList} пошли крюком (обход до ${worst}× длиннее прямой). Обычно это неверные стороны (right→left у узлов друг над другом, top→top / bottom→bottom у соседей) или узлы стоят слишком тесно. Сначала поставь встречные стороны (right→left / bottom→top), раздвинь узлы и вызови роутер снова. Если автоматический маршрут всё равно не подходит, допустима минимальная ручная ортогональная правка с последующей проверкой качества.`,
      );
    }

    const verdict =
      warnings.length > 0
        ? warnings[0]
        : after.counts.arrowArtifact === 0 && after.counts.arrowOverlap === 0
          ? 'Стрелки больше не режут артефакты и не сливаются.'
          : 'Часть конфликтов осталась: раздвинь узлы или поменяй стороны присоединения и вызови роутер снова.';

    return {
      data: {
        routed: outcome.routed.map((r) => ({
          arrowId: r.arrowId,
          bends: r.bends.length,
          fallback: r.fallback,
          crowded: r.crowded ?? false,
          hook: r.hook ?? false,
          detourRatio: r.detourRatio,
        })),
        skipped: outcome.skipped,
        variantsTried: outcome.variantsTried,
        portSwaps: outcome.portSwaps ?? 0,
        crowded: outcome.crowded ?? [],
        hooks: hooks.map((r) => r.arrowId),
        warnings,
        qualityBefore: { score: before.quality.score, cost: before.quality.cost },
        qualityAfter: { score: after.score, cost: after.cost, grade: after.grade },
        improvedBy: delta,
        counts: after.counts,
        verdict,
      },
      mutated: true,
    };
  },
};

export const boardCleanArrows: ToolSpec = {
  name: 'board_clean_arrows',
  description:
    'Убирает мёртвые изгибы: торчащие усы на углах, короткие ступеньки и куски линии, которые остались после сдвига блока. Не ищет новый маршрут — только выпрямляет то, что уже нарисовано. Если стрелка ходит крюком вокруг пустого места, после очистки вызови board_route_arrows.',
  parameters: objectSchema({
    arrowIds: {
      type: 'array',
      description: 'Какие стрелки почистить. Без него — все стрелки с изгибами.',
      items: { type: 'string' },
    },
  }),
  run: (args, ctx) => {
    const ids = Array.isArray(args.arrowIds)
      ? (args.arrowIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;

    const before = ctx.boards.read(ctx.boardId, (state) =>
      boardQuality(state.artifacts, state.arrows),
    );

    const outcome = ctx.boards.mutate(ctx.boardId, (state) => {
      const result = cleanArrowRoutes(state.artifacts, state.arrows, { arrowIds: ids });
      for (const cleaned of result.cleaned) {
        if (cleaned.changed) applyRoute(state, cleaned.arrowId, cleaned);
      }
      return result;
    });

    const after = ctx.boards.read(ctx.boardId, (state) =>
      boardQuality(state.artifacts, state.arrows),
    );
    ctx.boards.rememberQuality(ctx.boardId, after.cost);

    const changed = outcome.cleaned.filter((c) => c.changed);
    const dropped = changed.reduce((sum, c) => sum + Math.max(0, c.before - c.after), 0);
    const verdict =
      changed.length === 0
        ? 'Лишних изгибов не нашлось — полилинии уже совпадают с тем, что рисуется.'
        : `Убрано ${dropped} мёртвых точек с ${changed.length} стрелок. Если линия всё ещё ходит крюком, вызови board_route_arrows.`;

    return {
      data: {
        cleaned: outcome.cleaned.map((c) => ({
          arrowId: c.arrowId,
          before: c.before,
          after: c.after,
          changed: c.changed,
        })),
        skipped: outcome.skipped,
        changed: changed.length,
        bendsRemoved: dropped,
        qualityBefore: { score: before.score, cost: before.cost },
        qualityAfter: { score: after.score, cost: after.cost, grade: after.grade },
        verdict,
      },
      mutated: changed.length > 0,
    };
  },
};

export const boardQualityTool: ToolSpec = {
  name: 'board_quality',
  description:
    'Числовая оценка раскладки: score 0..100 (больше — лучше) и штраф cost (меньше — лучше), с разбором по причинам. Используй, чтобы понять, стало ли лучше после правок, и когда остановиться.',
  parameters: objectSchema({
    note: str('Необязательная пометка, зачем меряешь — попадёт в ответ'),
  }),
  run: (args, ctx) => {
    const quality = ctx.boards.read(ctx.boardId, (state) =>
      boardQuality(state.artifacts, state.arrows),
    );
    const previous = ctx.boards.previousQuality(ctx.boardId);
    ctx.boards.rememberQuality(ctx.boardId, quality.cost);

    return {
      data: {
        note: typeof args.note === 'string' ? args.note : undefined,
        score: quality.score,
        cost: quality.cost,
        grade: quality.grade,
        previousCost: previous,
        improvedBy: previous == null ? null : Math.round((previous - quality.cost) * 10) / 10,
        metrics: quality.metrics,
        breakdown: quality.breakdown,
        hints: quality.hints,
      },
    };
  },
};

export const layoutTools: ToolSpec[] = [boardRouteArrows, boardCleanArrows, boardQualityTool];
