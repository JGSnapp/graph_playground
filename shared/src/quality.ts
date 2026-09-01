import type { Arrow, Artifact } from './artifacts.js';
import { MIN_EDGE, MIN_MIXED_PORT, computeArrowGeometries } from './geometry.js';
import {
  checkIntersections,
  type CheckIntersectionsOptions,
  type IntersectionCounts,
  type IntersectionReport,
} from './intersections.js';

export interface QualityMetrics {
  artifacts: number;
  arrows: number;
  /** Arrows cutting through a box. */
  edgeNodeHits: number;
  crossings: number;
  shallowCrossings: number;
  mergedArrows: number;
  clearanceHits: number;
  overlaps: number;
  tightPairs: number;
  labelConflicts: number;
  bends: number;
  totalLength: number;
  /** Mean ratio of drawn length to the shortest orthogonal path; 1.0 is ideal. */
  detour: number;
}

export interface QualityPenalty {
  reason: string;
  count: number;
  cost: number;
}

export type QualityGrade = 'отлично' | 'хорошо' | 'терпимо' | 'плохо';

export interface LayoutQuality {
  /** 0..100, higher is better. Derived from `cost`, never negative. */
  score: number;
  /** Raw weighted penalty, lower is better. Use it to compare two layouts. */
  cost: number;
  grade: QualityGrade;
  metrics: QualityMetrics;
  counts: IntersectionCounts;
  breakdown: QualityPenalty[];
  hints: string[];
}

/**
 * Lexicographic-ish weights: things that make a diagram unreadable cost far
 * more than things that only make it less pretty.
 */
export const QUALITY_WEIGHTS = {
  artifactOverlap: 15,
  edgeNodeHit: 12,
  mergedArrow: 8,
  crossing: 4,
  shallowExtra: 2,
  labelConflict: 3,
  clearance: 2,
  tightSpacing: 1.5,
  extraBend: 2,
  detour: 6,
  shallowPort: 8,
  sharedPort: 8,
  shortEdge: 4,
};

/** How fast the score decays: cost 25 lands on score 50. */
const HALF_COST = 25;

const gradeFor = (score: number): QualityGrade => {
  if (score >= 90) return 'отлично';
  if (score >= 70) return 'хорошо';
  if (score >= 45) return 'терпимо';
  return 'плохо';
};

export interface QualityOptions extends CheckIntersectionsOptions {
  /** Reuse an already computed report instead of running the detector again. */
  report?: IntersectionReport;
}

export const boardQuality = (
  artifacts: Artifact[],
  arrows: Arrow[],
  options: QualityOptions = {},
): LayoutQuality => {
  const report = options.report ?? checkIntersections(artifacts, arrows, options);
  const counts = report.counts;
  const geometries = computeArrowGeometries(artifacts, arrows);

  let bends = 0;
  let extraBends = 0;
  let totalLength = 0;
  let detourSum = 0;
  let detourCount = 0;

  const arrowsById = new Map(arrows.map((arrow) => [arrow.id, arrow]));
  for (const [arrowId, geometry] of geometries) {
    // Render-time port stubs are implementation details, not user bends.
    const manualBends = arrowsById.get(arrowId)?.bends.length ?? 0;
    bends += manualBends;
    // A small intentional orthogonal route is free; only noisy routes are penalized.
    extraBends += Math.max(0, manualBends - 2);

    let length = 0;
    for (let i = 0; i < geometry.points.length - 1; i++) {
      const a = geometry.points[i];
      const b = geometry.points[i + 1];
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    totalLength += length;

    // Comparing an orthogonal line with the Euclidean diagonal punished nodes
    // merely for not sharing an axis. Manhattan distance is the true baseline
    // for the rectilinear graph rendered by the board.
    const direct =
      Math.abs(geometry.toPoint.x - geometry.fromPoint.x) +
      Math.abs(geometry.toPoint.y - geometry.fromPoint.y);
    if (direct > 1) {
      detourSum += length / direct;
      detourCount += 1;
    }
  }

  const shallowCrossings = report.findings.filter(
    (f) => f.kind === 'arrow_arrow' && f.shallow,
  ).length;
  const detour = detourCount > 0 ? detourSum / detourCount : 1;

  const breakdown: QualityPenalty[] = [
    {
      reason: 'наложение артефактов',
      count: counts.artifactArtifact,
      cost: counts.artifactArtifact * QUALITY_WEIGHTS.artifactOverlap,
    },
    {
      reason: 'стрелка сквозь артефакт',
      count: counts.arrowArtifact,
      cost: counts.arrowArtifact * QUALITY_WEIGHTS.edgeNodeHit,
    },
    {
      reason: 'стрелки слились в одну линию',
      count: counts.arrowOverlap,
      cost: counts.arrowOverlap * QUALITY_WEIGHTS.mergedArrow,
    },
    {
      reason: 'пересечения стрелок',
      count: counts.arrowArrow,
      cost: counts.arrowArrow * QUALITY_WEIGHTS.crossing,
    },
    {
      reason: 'пологие пересечения',
      count: shallowCrossings,
      cost: shallowCrossings * QUALITY_WEIGHTS.shallowExtra,
    },
    {
      reason: 'подписи налезают',
      count: counts.labelConflict,
      cost: counts.labelConflict * QUALITY_WEIGHTS.labelConflict,
    },
    {
      reason: 'стрелка идёт впритык к артефакту',
      count: counts.arrowClearance,
      cost: counts.arrowClearance * QUALITY_WEIGHTS.clearance,
    },
    {
      reason: 'артефакты стоят слишком тесно',
      count: counts.tightSpacing,
      cost: counts.tightSpacing * QUALITY_WEIGHTS.tightSpacing,
    },
    {
      reason: 'лишние изгибы',
      count: extraBends,
      cost: extraBends * QUALITY_WEIGHTS.extraBend,
    },
    {
      reason: 'стрелки идут в обход',
      count: Math.round(Math.max(0, detour - 1) * 100),
      cost: Math.max(0, detour - 1) * QUALITY_WEIGHTS.detour * geometries.size,
    },
    {
      reason: 'вход в карточку слишком пологий',
      count: counts.arrowPortAngle,
      cost: counts.arrowPortAngle * QUALITY_WEIGHTS.shallowPort,
    },
    {
      reason: 'вход и выход в одной точке',
      count: counts.arrowSharedPort,
      cost: counts.arrowSharedPort * QUALITY_WEIGHTS.sharedPort,
    },
    {
      reason: 'слишком короткое ребро',
      count: counts.arrowShortEdge,
      cost: counts.arrowShortEdge * QUALITY_WEIGHTS.shortEdge,
    },
  ].filter((entry) => entry.cost > 0);

  const cost = Math.round(breakdown.reduce((sum, entry) => sum + entry.cost, 0) * 10) / 10;
  const score = Math.round(100 / (1 + cost / HALF_COST));

  const hints: string[] = [];
  if (counts.artifactArtifact > 0) hints.push('Раздвинь наложенные артефакты — это самое дорогое.');
  if (counts.arrowArtifact > 0) {
    hints.push(
      'Стрелки режут артефакты. В тесной раскладке роутер откажется: сначала раздвинь узлы (от 100px между соседями), потом один раз board_route_arrows.',
    );
  }
  if (counts.arrowOverlap > 0) {
    hints.push('Часть стрелок слилась: задай им разные порты (offset) или перемаршрутизируй.');
  }
  if (detour > 1.6) {
    hints.push(
      'Стрелки идут крюком: сначала проверь встречные стороны и расстояние между узлами. Если автороутер не выражает нужную трассу, допустима минимальная ручная ортогональная правка.',
    );
  }
  if (arrows.some((arrow) => arrow.bends.length > 2)) {
    hints.push(
      'На стрелках лишние изгибы: вызови board_clean_arrows, чтобы убрать усы и ступеньки после сдвига блоков.',
    );
  }
  if (counts.arrowArrow > 0 && counts.arrowArtifact === 0) {
    hints.push('Остались пересечения стрелок: поменяй порядок узлов в слое или стороны присоединения.');
  }
  if (counts.tightSpacing > 0) hints.push('Между соседями мало воздуха — увеличь шаг сетки.');
  if (counts.labelConflict > 0) hints.push('Подписям не хватает места — удлини участок стрелки под подпись.');
  if (counts.arrowPortAngle > 0) {
    hints.push(
      'Стрелка входит в карточку плашмя (меньше 30°). Сторона должна смотреть на соседа, затем board_route_arrows — последний отрезок будет под 90°.',
    );
  }
  if (counts.arrowSharedPort > 0) {
    hints.push(`Вход и выход ближе ${MIN_MIXED_PORT}px: две исходящие или две входящие делить точку могут, смешанные — нет. Возьми другую сторону.`);
  }
  if (counts.arrowShortEdge > 0) {
    hints.push(`Ребро короче ${MIN_EDGE}px: раздвинь узлы или вызови board_route_arrows.`);
  }

  return {
    score,
    cost,
    grade: gradeFor(score),
    metrics: {
      artifacts: artifacts.length,
      arrows: arrows.length,
      edgeNodeHits: counts.arrowArtifact,
      crossings: counts.arrowArrow,
      shallowCrossings,
      mergedArrows: counts.arrowOverlap,
      clearanceHits: counts.arrowClearance,
      overlaps: counts.artifactArtifact,
      tightPairs: counts.tightSpacing,
      labelConflicts: counts.labelConflict,
      bends,
      totalLength: Math.round(totalLength),
      detour: Math.round(detour * 100) / 100,
    },
    counts,
    breakdown,
    hints,
  };
};

/** Human readable one-liner for tool results and the board header. */
export const qualitySummary = (quality: LayoutQuality): string =>
  `качество ${quality.score}/100 (${quality.grade}), штраф ${quality.cost}`;
