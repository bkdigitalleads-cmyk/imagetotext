/**
 * Vision hands back lines. People read paragraphs. These helpers put the
 * lines in reading order and group them into paragraphs from their
 * geometry: the vertical gap between lines, the left edge, a first-line
 * indent, a short last line, a change in letter height, a list marker.
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

/** A list item: "- ", "• ", "* ", "1. ", "2) ", "a) ". */
export const LIST_MARKER = /^\s*(?:[-•*·]|\d{1,3}[.)]|[a-zA-Z][.)])\s+\S/;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sameRow(a: Px, b: Px): boolean {
  const ca = (a.top + a.bottom) / 2;
  const cb = (b.top + b.bottom) / 2;
  return Math.abs(ca - cb) < 0.5 * Math.min(a.height, b.height);
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
 * Keeps Vision's order (it already handles columns), with two local fixes:
 * pieces of the same row come left to right, and a row Vision split in two
 * across a small gap becomes one line again.
 */
export function orderLines(lines: OcrLine[], width = 1, height = 1): OcrLine[] {
  const out = [...lines];
  // Left to right within a row: swap neighbors that are on one row but backwards.
  for (let pass = 0; pass < out.length; pass++) {
    let swapped = false;
    for (let i = 0; i + 1 < out.length; i++) {
      const a = px(out[i].box, width, height);
      const b = px(out[i + 1].box, width, height);
      if (sameRow(a, b) && b.left < a.left) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  // Pieces of one row with a gap smaller than about two letters tall become one line.
  const merged: OcrLine[] = [];
  for (const line of out) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const a = px(prev.box, width, height);
      const b = px(line.box, width, height);
      const gap = b.left - a.right;
      if (sameRow(a, b) && gap >= -0.2 * a.height && gap < 1.5 * Math.min(a.height, b.height)) {
        merged[merged.length - 1] = joinLine(prev, line);
        continue;
      }
    }
    merged.push(line);
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
      gap > 0.85 * h || // a blank line's worth of space
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
