/**
 * Board -> PNG renderer for the benchmark harness.
 *
 * Mirrors what `web/src/components/board` draws, so a screenshot taken here can
 * be judged the way a user judges the real board. Uses resvg (no browser).
 */
import { Resvg } from '@resvg/resvg-js';
import {
  arrowHeadVertices,
  arrowPathData,
  boundsOf,
  computeArrowGeometries,
  labelAnchor,
  rectsIntersect,
  type Arrow,
  type Artifact,
  type BoardState,
  type Rect,
} from '@teca/shared';

const NOTE_FILL: Record<string, string> = {
  yellow: '#3a3320',
  blue: '#1e2b3d',
  green: '#1f3328',
  pink: '#3a2330',
  purple: '#2b2440',
  gray: '#23262d',
};

const TYPE_FILL: Record<string, string> = {
  note: '#3a3320',
  text: 'transparent',
  shape: '#1f2430',
  image: '#26303a',
  website: '#141821',
  console: '#0c0f0c',
  code: '#0f1216',
};

const esc = (value: string): string =>
  value.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;',
  );

const str = (props: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
};

const num = (props: Record<string, unknown>, key: string, fallback: number): number => {
  const value = props[key];
  return typeof value === 'number' ? value : fallback;
};

/** Rough monospace-ish advance; good enough to know whether text overflows. */
const charWidth = (fontSize: number, bold = false): number => fontSize * (bold ? 0.58 : 0.53);

interface Line {
  text: string;
  bold: boolean;
  size: number;
}

/** Wraps markdown-ish artifact text into lines that fit `width`. */
const layoutText = (raw: string, width: number, baseSize: number): Line[] => {
  const out: Line[] = [];
  for (const source of raw.split('\n')) {
    const heading = /^(#{1,6})\s+/.exec(source);
    const bold = Boolean(heading);
    const size = heading ? baseSize + 2 : baseSize;
    const clean = source
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/[*_`]/g, '')
      .trimEnd();
    if (!clean.trim()) {
      out.push({ text: '', bold, size });
      continue;
    }
    const max = Math.max(4, Math.floor(width / charWidth(size, bold)));
    let line = '';
    for (const word of clean.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= max) {
        line = next;
        continue;
      }
      if (line) out.push({ text: line, bold, size });
      line = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    }
    if (line) out.push({ text: line, bold, size });
  }
  return out;
};

const textBlock = (
  lines: Line[],
  x: number,
  y: number,
  color: string,
  maxLines: number,
  lineHeight: number,
): string =>
  lines
    .slice(0, maxLines)
    .map((line, index) => {
      if (!line.text) return '';
      return `<text x="${x}" y="${y + index * lineHeight}" font-family="Segoe UI, Arial, sans-serif" font-size="${line.size}" font-weight="${line.bold ? 650 : 400}" fill="${color}">${esc(line.text)}</text>`;
    })
    .join('');

const artifactSvg = (a: Artifact): string => {
  const props = a.props as Record<string, unknown>;
  const pad = 12;
  const inner = a.width - pad * 2;

  if (a.type === 'shape') {
    const shape = str(props, 'shape', 'rect');
    const fill = str(props, 'fill', '#1f2430');
    const stroke = str(props, 'stroke', '#5b6478');
    const w = a.width;
    const h = a.height;
    const geom =
      shape === 'ellipse'
        ? `<ellipse cx="${a.x + w / 2}" cy="${a.y + h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
        : shape === 'diamond'
          ? `<polygon points="${a.x + w / 2},${a.y + 1} ${a.x + w - 1},${a.y + h / 2} ${a.x + w / 2},${a.y + h - 1} ${a.x + 1},${a.y + h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
          : shape === 'triangle'
            ? `<polygon points="${a.x + w / 2},${a.y + 1} ${a.x + w - 1},${a.y + h - 1} ${a.x + 1},${a.y + h - 1}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
            : `<rect x="${a.x + 1}" y="${a.y + 1}" width="${w - 2}" height="${h - 2}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    const label = str(props, 'label');
    const lines = layoutText(label, inner, 14);
    const startY = a.y + h / 2 - ((Math.min(lines.length, 4) - 1) * 18) / 2 + 5;
    return `${geom}${lines
      .slice(0, 4)
      .map(
        (line, i) =>
          `<text x="${a.x + w / 2}" y="${startY + i * 18}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${line.size}" font-weight="${line.bold ? 650 : 500}" fill="#e8e8ea">${esc(line.text)}</text>`,
      )
      .join('')}`;
  }

  if (a.type === 'text') {
    const size = num(props, 'fontSize', 24);
    const color = str(props, 'color', '#e8e8ea');
    const weight = num(props, 'weight', 600);
    const lines = layoutText(str(props, 'text'), a.width, size);
    return lines
      .slice(0, Math.max(1, Math.floor(a.height / (size * 1.35))))
      .map(
        (line, i) =>
          `<text x="${a.x}" y="${a.y + size + i * size * 1.35}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(line.text)}</text>`,
      )
      .join('');
  }

  const fill =
    a.type === 'note' ? (NOTE_FILL[str(props, 'color', 'yellow')] ?? NOTE_FILL.yellow) : (TYPE_FILL[a.type] ?? '#1a1e26');
  const frame = `<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="10" fill="${fill}" stroke="#2b303b" stroke-width="1"/>`;

  if (a.type === 'code') {
    const title = str(props, 'title') || str(props, 'language', 'code');
    const lines = layoutText(str(props, 'code'), inner, 12);
    return `${frame}<text x="${a.x + pad}" y="${a.y + 20}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#7d879c">${esc(title)}</text>${textBlock(lines, a.x + pad, a.y + 42, '#c9d2e3', Math.floor((a.height - 46) / 16), 16)}`;
  }

  if (a.type === 'console') {
    const title = str(props, 'title', 'console');
    const raw = Array.isArray(props.lines) ? (props.lines as unknown[]).map(String).join('\n') : '';
    const lines = layoutText(raw, inner, 12);
    return `${frame}<text x="${a.x + pad}" y="${a.y + 20}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#7d879c">${esc(title)}</text>${textBlock(lines, a.x + pad, a.y + 42, '#9fd8a4', Math.floor((a.height - 46) / 16), 16)}`;
  }

  if (a.type === 'website' || a.type === 'image') {
    const caption = str(props, 'title') || str(props, 'url') || str(props, 'alt') || a.type;
    return `${frame}<text x="${a.x + pad}" y="${a.y + 24}" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#9aa4ba">${esc(caption.slice(0, 60))}</text>`;
  }

  const lines = layoutText(str(props, 'text'), inner, 13);
  return `${frame}${textBlock(lines, a.x + pad, a.y + 26, '#e8e8ea', Math.floor((a.height - 18) / 18), 18)}`;
};

const arrowSvg = (arrow: Arrow, points: { x: number; y: number }[], toPoint: { x: number; y: number }, toSide: 'top' | 'right' | 'bottom' | 'left'): string => {
  const color = arrow.style.color ?? '#8b93a7';
  const d = arrowPathData(points, arrow.routing);
  const head = arrowHeadVertices(toPoint, toSide, 10);
  const dash = arrow.style.dashed ? ' stroke-dasharray="6 5"' : '';
  const anchor = labelAnchor(points);
  const label =
    arrow.label && anchor
      ? anchor.horizontal
        ? `<text x="${anchor.point.x}" y="${anchor.point.y - 6}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#c2cadb">${esc(arrow.label)}</text>`
        : `<text x="${anchor.point.x + 6}" y="${anchor.point.y + 4}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#c2cadb">${esc(arrow.label)}</text>`
      : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${arrow.style.width ?? 1.8}"${dash}/><polygon points="${head.map((v) => `${v.x},${v.y}`).join(' ')}" fill="${color}"/>${label}`;
};

export const boardRegion = (state: BoardState, pad = 100): Rect => {
  if (state.artifacts.length === 0) return { x: -200, y: -150, width: 1200, height: 800 };
  const bounds = boundsOf(state.artifacts);
  const geometries = computeArrowGeometries(state.artifacts, state.arrows);
  let minX = bounds.x;
  let minY = bounds.y;
  let maxX = bounds.x + bounds.width;
  let maxY = bounds.y + bounds.height;
  for (const geometry of geometries.values()) {
    for (const p of geometry.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
};

export const boardSvg = (state: BoardState, region: Rect): string => {
  const visible = state.artifacts.filter((a) => rectsIntersect(a, region)).sort((a, b) => a.z - b.z);
  const geometries = computeArrowGeometries(state.artifacts, state.arrows);
  const arrows = state.arrows
    .map((arrow) => {
      const geometry = geometries.get(arrow.id);
      if (!geometry) return '';
      return arrowSvg(arrow, geometry.points, geometry.toPoint, geometry.toSide);
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x} ${region.y} ${region.width} ${region.height}" width="${Math.round(region.width)}" height="${Math.round(region.height)}">
<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" fill="#0e1014"/>
${arrows}
${visible.map(artifactSvg).join('\n')}
</svg>`;
};

/** Renders the whole composition into a PNG buffer capped at `maxSize` px. */
export const boardPng = (state: BoardState, maxSize = 1600): Buffer => {
  const region = boardRegion(state);
  const svg = boardSvg(state, region);
  const longest = Math.max(region.width, region.height);
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
    fitTo: longest > maxSize ? { mode: 'width' as const, value: Math.round((region.width / longest) * maxSize) } : { mode: 'original' as const },
  });
  return Buffer.from(resvg.render().asPng());
};
