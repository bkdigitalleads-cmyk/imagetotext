/**
 * Vision hands back lines. People read paragraphs. These helpers put the
 * lines in reading order and group them into paragraphs from their
 * geometry: the vertical gap between lines, the left edge, a first-line
 * indent, a short last line, a change in letter height, a list marker.
 *
 * Coordinates: every box here is top-left origin (y grows down the page).
 * Vision's own boxes are bottom-left origin; the Swift module flips them
 * (y = 1 - y - height, see `flipVisionBox`) before they reach JavaScript,
 * for line boxes, word boxes and second-pass words alike. Vision's result
 * order is not reading order (handwriting can come back bottom to top), so
 * `orderLines` always sorts.
 *
 * Pure TypeScript with no imports at runtime, so the unit checks can load it
 * straight from Node. Boxes are fractions of the image; pass the image size
 * so x and y distances are compared in the same units (pixels).
 */
import type { OcrBox, OcrLine } from './VisionOcr.types';

export interface Paragraph {
  lines: OcrLine[];
}

interface Px {
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
}

const px = (b: OcrBox, w: number, h: number): Px => ({
  left: b.x * w,
  right: (b.x + b.width) * w,
  top: b.y * h,
  bottom: (b.y + b.height) * h,
  height: b.height * h,
});

/**
 * A list item: a dash or bullet ("- ", "-Eggs", "\u2013 ", "\u2022 ", "* "), a
 * checkbox ("[ ] ", "[x] ", "\u2610 "), or a number or letter with "." or ")"
 * and a space ("1. ", "2) ", "a) "). Kept identical to LIST_MARKER in src/text.ts.
 */
export const LIST_MARKER =
  /^\s*(?:[-\u2013\u2014\u2022*\u00b7\u25aa\u25e6\u25cb\u25a1\u2610\u2611\u2612\u2713\u2714](?:\s+(?=\S)|(?=[\p{L}"'(]))|\[[ xX\u2713]?\]\s*\S|\d{1,3}[.)]\s+\S|[a-zA-Z][.)]\s+\S)/u;

/** Two lines are one paragraph only when the gap between them is under this many median line heights. */
export const PARAGRAPH_GAP = 0.6;

/**
 * Vision's box (fractions, origin bottom left) as the top-left box used
 * everywhere in the app. The Swift module does exactly this; it is here so
 * the unit checks can feed Vision-style fixtures through the same math.
 */
export function flipVisionBox(b: OcrBox): OcrBox {
  return { x: b.x, y: 1 - b.y - b.height, width: b.width, height: b.height };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const overlapY = (a: Px, b: Px) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const overlapX = (a: Px, b: Px) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

/**
 * Two boxes on one row: they share at least half their height, or they sit
 * side by side with a small gap and share a fifth of it (the two halves of
 * a line written on a slant).
 */
function sameRow(a: Px, b: Px): boolean {
  const minH = Math.min(a.height, b.height);
  const oy = overlapY(a, b);
  if (oy >= 0.5 * minH) return true;
  const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
  return overlapX(a, b) === 0 && gap < 1.5 * minH && oy >= 0.2 * minH;
}

function union(a: OcrBox, b: OcrBox): OcrBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Two pieces of one printed line, left then right, as one line. */
function joinLine(a: OcrLine, b: OcrLine): OcrLine {
  const shift = a.text.length + 1;
  return {
    text: `${a.text} ${b.text}`,
    confidence: Math.min(a.confidence, b.confidence),
    box: union(a.box, b.box),
    words: [...a.words, ...b.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }))],
    // Alternatives are per piece, so they no longer line up with the joined text.
    alternatives: [],
  };
}

/**
 * A gutter between two columns of text, as an x position in pixels, or
 * null. A column split needs at least two lines on each side, side by side
 * on the page, and must not be a table: when most lines on the right sit on
 * the same row as a line on the left (a receipt's prices), it is rows, not columns.
 */
function findGutter(boxes: Px[], h: number): number | null {
  if (boxes.length < 4) return null;
  const spans = boxes.map((b) => [b.left, b.right]).sort((a, b) => a[0] - b[0]);
  let best: { at: number; width: number } | null = null;
  let reach = spans[0][1];
  for (let i = 1; i < spans.length; i++) {
    const [l, r] = spans[i];
    if (l - reach >= h && (!best || l - reach > best.width)) best = { at: (l + reach) / 2, width: l - reach };
    reach = Math.max(reach, r);
  }
  if (!best) return null;
  const at = best.at;
  const left = boxes.filter((b) => b.right <= at);
  const right = boxes.filter((b) => b.left >= at);
  if (left.length < 2 || right.length < 2) return null;
  const band = (list: Px[]) => [Math.min(...list.map((b) => b.top)), Math.max(...list.map((b) => b.bottom))];
  const [lt, lb] = band(left);
  const [rt, rb] = band(right);
  if (Math.min(lb, rb) - Math.max(lt, rt) < 0.5 * Math.min(lb - lt, rb - rt)) return null;
  const aligned = right.filter((r) => left.some((l) => overlapY(l, r) >= 0.5 * Math.min(l.height, r.height))).length;
  return aligned / right.length >= 0.6 ? null : at;
}

/** Lines sorted top to bottom into rows, each row left to right. */
function rowsInOrder(items: { line: OcrLine; px: Px }[]): { line: OcrLine; px: Px }[] {
  const sorted = [...items].sort((a, b) => a.px.top - b.px.top || a.px.left - b.px.left);
  const rows: { line: OcrLine; px: Px }[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && row.some((r) => sameRow(r.px, it.px))) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.px.left - b.px.left));
}

/**
 * Reading order, whatever order Vision returned: top to bottom, and left
 * to right within a row. Two columns of running text are read one column
 * after the other. Pieces of one row with a gap smaller than about one and
 * a half letters tall (Vision splits slanted or spaced-out lines) become one line.
 */
export function orderLines(lines: OcrLine[], width = 1, height = 1): OcrLine[] {
  const items = lines.map((line) => ({ line, px: px(line.box, width, height) }));
  if (items.length === 0) return [];
  const h = median(items.map((i) => i.px.height)) || 1;
  const gutter = findGutter(items.map((i) => i.px), h);
  const ordered =
    gutter == null
      ? rowsInOrder(items)
      : [...rowsInOrder(items.filter((i) => i.px.left < gutter)), ...rowsInOrder(items.filter((i) => i.px.left >= gutter))];

  const merged: OcrLine[] = [];
  let prevPx: Px | null = null;
  for (const { line, px: b } of ordered) {
    const prev = merged[merged.length - 1];
    if (prev && prevPx) {
      const gap = b.left - prevPx.right;
      if (sameRow(prevPx, b) && gap >= -0.2 * prevPx.height && gap < 1.5 * Math.min(prevPx.height, b.height)) {
        merged[merged.length - 1] = joinLine(prev, line);
        prevPx = px(merged[merged.length - 1].box, width, height);
        continue;
      }
    }
    merged.push(line);
    prevPx = b;
  }
  return merged;
}

/** Lines in reading order to paragraphs. */
export function groupParagraphs(lines: OcrLine[], width = 1, height = 1): Paragraph[] {
  if (lines.length === 0) return [];
  const boxes = lines.map((l) => px(l.box, width, height));
  const h = median(boxes.map((b) => b.height)) || 1;
  const paragraphs: Paragraph[] = [];
  let current: OcrLine[] = [lines[0]];
  let left = boxes[0].left;
  let right = boxes[0].right;

  for (let i = 1; i < lines.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    const prevText = lines[i - 1].text.trim();
    const gap = b.top - a.bottom;
    const ratio = Math.max(a.height, b.height) / Math.max(1e-9, Math.min(a.height, b.height));
    const widest = Math.max(right, b.right) - Math.min(left, b.left);
    // A first line indented and the next one flush left is still one paragraph.
    const firstLineIndent = current.length === 1 && a.left - b.left > 0.8 * h && a.left - b.left < 5 * h;

    const breakHere =
      gap >= PARAGRAPH_GAP * h || // more space than lines of one paragraph have (relative to this page's writing)
      b.top < a.top - 0.5 * h || // went back up: another column or block
      ratio > 1.45 || // a heading and its text
      LIST_MARKER.test(lines[i].text) || // a new list item
      (!firstLineIndent && current.length > 1 && b.left - left > 1.2 * h) || // an indented first line
      (!firstLineIndent && left - b.left > 1.2 * h) || // starts well left of this paragraph
      (/[.!?:;"”)]$/.test(prevText) && a.right < Math.max(right, b.right) - 0.25 * widest); // a short last line

    if (breakHere) {
      paragraphs.push({ lines: current });
      current = [lines[i]];
      left = b.left;
      right = b.right;
    } else {
      current.push(lines[i]);
      left = firstLineIndent ? b.left : Math.min(left, b.left);
      right = Math.max(right, b.right);
    }
  }
  paragraphs.push({ lines: current });
  return paragraphs;
}

/** A paragraph's text with its line breaks as they were on the page. */
export function paragraphText(p: Paragraph): string {
  return p.lines.map((l) => l.text).join('\n');
}
