/**
 * Vision hands back lines. People read paragraphs. These helpers put the
 * lines in reading order and group them into paragraphs from their
 * geometry: the vertical gap between lines, the left edge, a first-line
 * indent, a short last line, a change in letter height, a list marker.
 *
 * Coordinates: every box here is top-left origin (y grows down the page),
 * as fractions of an upright image. The Swift module turns every image
 * upright in pixels before Vision reads it and flips Vision's bottom-left
 * boxes (y = 1 - y - height, see `flipVisionBox`), for every path: a
 * flattened page, a crop, an untouched photo, a file, a PDF page. Vision's
 * result order is not reading order (handwriting can come back bottom to
 * top), so `orderLines` always sorts.
 *
 * A page photographed at an angle: when the text's own angle (from the
 * lines' corners) is more than SKEW_MIN_DEGREES, everything here is measured
 * along the text's axis instead of the image's.
 *
 * Pure TypeScript with no imports at runtime, so the unit checks can load it
 * straight from Node. Pass the image size so x and y are compared in pixels.
 */
import type { OcrBox, OcrLine } from './VisionOcr.types';

export interface Paragraph {
  lines: OcrLine[];
}

/**
 * A list item: a dash or bullet ("- ", "-Eggs", "\u2013 ", "\u2022 ", "* "), a
 * checkbox ("[ ] ", "[x] ", "\u2610 "), or a number or letter with "." or ")"
 * and a space ("1. ", "2) ", "a) "). Kept identical to LIST_MARKER in src/text.ts.
 */
export const LIST_MARKER =
  /^\s*(?:[-\u2013\u2014\u2022*\u00b7\u25aa\u25e6\u25cb\u25a1\u2610\u2611\u2612\u2713\u2714](?:\s+(?=\S)|(?=[\p{L}"'(]))|\[[ xX\u2713]?\]\s*\S|\d{1,3}[.)]\s+\S|[a-zA-Z][.)]\s+\S)/u;

/** Handwriting: two lines are one paragraph only when the gap is under this many median line heights. */
export const PARAGRAPH_GAP = 0.6;
/** Print (line heights within 15% of each other): the same, with a looser gap. */
export const PARAGRAPH_GAP_PRINT = 1.0;
/** Line heights within this share of the median count as print. */
export const PRINT_HEIGHT_SPREAD = 0.15;
/** A page whose text sits at more than this angle is read along the text, not the image. */
export const SKEW_MIN_DEGREES = 5;

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

// ---------- geometry along the text's axis ----------

/** A line measured in pixels along the page's text axis. */
interface Geo {
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  cx: number;
  cy: number;
  /** The line's own angle in radians, y down (positive slopes down to the right). */
  angle: number;
  /** Length along its own axis. */
  length: number;
}

interface Shape {
  cx: number;
  cy: number;
  length: number;
  height: number;
  angle: number;
}

/** A line's center, length, height and angle in image pixels, from its corners when it has them. */
function shapeOf(line: OcrLine, w: number, h: number): Shape {
  const c = line.corners;
  if (c && c.length === 8) {
    const p = [0, 2, 4, 6].map((i) => ({ x: c[i] * w, y: c[i + 1] * h }));
    const [tl, tr, br, bl] = p;
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
    return {
      cx: (tl.x + tr.x + br.x + bl.x) / 4,
      cy: (tl.y + tr.y + br.y + bl.y) / 4,
      length: (d(tl, tr) + d(bl, br)) / 2,
      height: (d(tl, bl) + d(tr, br)) / 2,
      angle: Math.atan2(tr.y - tl.y + (br.y - bl.y), tr.x - tl.x + (br.x - bl.x)),
    };
  }
  const b = line.box;
  return { cx: (b.x + b.width / 2) * w, cy: (b.y + b.height / 2) * h, length: b.width * w, height: b.height * h, angle: 0 };
}

/**
 * The page's text angle in radians: the length-weighted median of the long
 * lines' own angles, or 0 when it is under SKEW_MIN_DEGREES (or unknown).
 */
export function pageAngle(lines: OcrLine[], w = 1, h = 1): number {
  const shapes = lines.filter((l) => l.corners && l.corners.length === 8).map((l) => shapeOf(l, w, h));
  const long = shapes.filter((s) => s.length > 2 * s.height);
  if (long.length === 0) return 0;
  const sorted = [...long].sort((a, b) => a.angle - b.angle);
  const total = sorted.reduce((t, s) => t + s.length, 0);
  let acc = 0;
  let angle = 0;
  for (const s of sorted) {
    acc += s.length;
    if (acc >= total / 2) {
      angle = s.angle;
      break;
    }
  }
  return Math.abs(angle) >= (SKEW_MIN_DEGREES * Math.PI) / 180 ? angle : 0;
}

/** A line in the frame turned by -theta about the page center, so text runs level. */
function geoOf(line: OcrLine, w: number, h: number, theta: number): Geo {
  const s = shapeOf(line, w, h);
  const dx = s.cx - w / 2;
  const dy = s.cy - h / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = w / 2 + dx * cos + dy * sin;
  const cy = h / 2 - dx * sin + dy * cos;
  return {
    left: cx - s.length / 2,
    right: cx + s.length / 2,
    top: cy - s.height / 2,
    bottom: cy + s.height / 2,
    height: s.height,
    cx,
    cy,
    angle: s.angle,
    length: s.length,
  };
}

const overlapY = (a: Geo, b: Geo) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Two lines on one row: they share at least half their height. */
function sameRow(a: Geo, b: Geo): boolean {
  return overlapY(a, b) >= 0.5 * Math.min(a.height, b.height);
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

/** Two pieces of one line, left then right, as one line. Corners: the left piece's left side, the right piece's right side. */
function joinLine(a: OcrLine, b: OcrLine): OcrLine {
  const shift = a.text.length + 1;
  const ca = a.corners;
  const cb = b.corners;
  const tokens = (a.text.match(/\S+/g) ?? []).length;
  const unknown = a.unknown || b.unknown ? [...(a.unknown ?? []), ...(b.unknown ?? []).map((k) => k + tokens)] : undefined;
  const first = a.firstConfidence ?? b.firstConfidence;
  return {
    text: `${a.text} ${b.text}`,
    confidence: Math.min(a.confidence, b.confidence),
    box: union(a.box, b.box),
    ...(ca && cb && ca.length === 8 && cb.length === 8 ? { corners: [ca[0], ca[1], cb[2], cb[3], cb[4], cb[5], ca[6], ca[7]] } : {}),
    words: [...a.words, ...b.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }))],
    // Alternatives are per piece, so they no longer line up with the joined text.
    alternatives: [],
    ...(unknown ? { unknown } : {}),
    ...(first != null ? { firstConfidence: Math.min(a.firstConfidence ?? a.confidence, b.firstConfidence ?? b.confidence) } : {}),
  };
}

// ---------- reading order ----------

interface Item {
  line: OcrLine;
  g: Geo;
}

/**
 * Pieces of a line written at a slant that Vision split apart, joined:
 * starting from a piece whose own angle differs from the page's by more
 * than SKEW_MIN_DEGREES, the next pieces to its right whose centers sit
 * within half a line height of its line, with gaps under two line heights.
 * Level text is left alone here (it is joined row by row later), so lines
 * of neighbouring columns never run together.
 */
function joinSlanted(items: Item[], w: number, h: number, theta: number): Item[] {
  const limit = (SKEW_MIN_DEGREES * Math.PI) / 180;
  const used = new Set<Item>();
  const out: Item[] = [];
  const byLeft = [...items].sort((a, b) => a.g.left - b.g.left);
  for (const start of byLeft) {
    if (used.has(start)) continue;
    used.add(start);
    if (Math.abs(start.g.angle - theta) <= limit) {
      out.push(start);
      continue;
    }
    let line = start.line;
    let end = start.g;
    const slope = Math.tan(start.g.angle - theta);
    const lineH = start.g.height;
    for (const next of byLeft) {
      if (used.has(next) || next.g.left < end.right - 0.5 * lineH) continue;
      const gap = next.g.left - end.right;
      const expectedY = start.g.cy + slope * (next.g.cx - start.g.cx);
      if (gap < 2 * lineH && Math.abs(next.g.cy - expectedY) < 0.5 * lineH) {
        used.add(next);
        line = joinLine(line, next.line);
        end = next.g;
      }
    }
    out.push({ line, g: geoOf(line, w, h, theta) });
  }
  return out;
}

/**
 * A gutter between columns, as an x position, or null. A gutter is a gap no
 * line crosses, at least `minGap` wide, with lines on both sides that sit
 * side by side. It is not a gutter when the two sides make a table (a
 * receipt's prices): most lines on the right share a row with a line on the
 * left and are much shorter or mostly figures.
 */
function verticalCut(items: Item[], minGap: number): number | null {
  if (items.length < 2) return null;
  const spans = items.map((i) => [i.g.left, i.g.right]).sort((a, b) => a[0] - b[0]);
  let best: { at: number; width: number } | null = null;
  let reach = spans[0][1];
  for (let k = 1; k < spans.length; k++) {
    const [l, r] = spans[k];
    if (l - reach >= minGap && (!best || l - reach > best.width)) best = { at: (l + reach) / 2, width: l - reach };
    reach = Math.max(reach, r);
  }
  if (!best) return null;
  const at = best.at;
  const left = items.filter((i) => i.g.right <= at);
  const right = items.filter((i) => i.g.left >= at);
  if (left.length === 0 || right.length === 0) return null;
  // Columns have lines on both sides; two pieces of one row with a modest gap are one line, joined later.
  if ((left.length < 2 || right.length < 2) && best.width < 2.5 * minGap) return null;
  const band = (list: Item[]) => [Math.min(...list.map((i) => i.g.top)), Math.max(...list.map((i) => i.g.bottom))];
  const [lt, lb] = band(left);
  const [rt, rb] = band(right);
  if (Math.min(lb, rb) - Math.max(lt, rt) <= 0) return null; // one above the other: rows, not columns
  const aligned = right.filter((r) => left.some((l) => sameRow(l.g, r.g))).length / right.length;
  const lw = median(left.map((i) => i.g.length));
  const rw = median(right.map((i) => i.g.length));
  const figures = right.filter((i) => /\d/.test(i.line.text)).length / right.length;
  const table = aligned >= 0.6 && (rw < 0.6 * lw || figures >= 0.6);
  return table ? null : at;
}

/** The widest gap no line crosses, top to bottom, as a y position, or null. */
function horizontalCut(items: Item[]): number | null {
  if (items.length < 2) return null;
  const spans = items.map((i) => [i.g.top, i.g.bottom]).sort((a, b) => a[0] - b[0]);
  let best: { at: number; width: number } | null = null;
  let reach = spans[0][1];
  for (let k = 1; k < spans.length; k++) {
    const [t, b] = spans[k];
    if (t - reach > 0 && (!best || t - reach > best.width)) best = { at: (t + reach) / 2, width: t - reach };
    reach = Math.max(reach, b);
  }
  return best ? best.at : null;
}

/**
 * Blocks in reading order (a recursive cut): columns are split first, left
 * then right; otherwise the widest band of empty space splits top from
 * bottom. A title or footer across all columns ends up in its own band, so
 * it comes before or after them. A block that cannot be split is one row.
 */
function cutBlocks(items: Item[], lineH: number): Item[][] {
  if (items.length <= 1) return [items];
  const v = verticalCut(items, 0.6 * lineH);
  if (v != null) {
    return [...cutBlocks(items.filter((i) => i.g.right <= v), lineH), ...cutBlocks(items.filter((i) => i.g.left >= v), lineH)];
  }
  const hz = horizontalCut(items);
  if (hz != null) {
    return [...cutBlocks(items.filter((i) => i.g.bottom <= hz), lineH), ...cutBlocks(items.filter((i) => i.g.top >= hz), lineH)];
  }
  return [items];
}

/** Lines in one block, top to bottom in rows, each row left to right. */
function rowsInOrder(items: Item[]): Item[] {
  const sorted = [...items].sort((a, b) => a.g.top - b.g.top || a.g.left - b.g.left);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && row.some((r) => sameRow(r.g, it.g))) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.g.left - b.g.left));
}

/**
 * Reading order, whatever order Vision returned: columns left to right,
 * top to bottom within a column, a title across the columns before them,
 * along the text's own axis when the page is turned. Slanted pieces of one
 * line are joined first; pieces of one row with a gap under about one and a
 * half letters tall are joined after.
 */
export function orderLines(lines: OcrLine[], width = 1, height = 1): OcrLine[] {
  if (lines.length === 0) return [];
  const theta = pageAngle(lines, width, height);
  let items: Item[] = lines.map((line) => ({ line, g: geoOf(line, width, height, theta) }));
  items = joinSlanted(items, width, height, theta);
  const lineH = median(items.map((i) => i.g.height)) || 1;
  const out: OcrLine[] = [];
  for (const block of cutBlocks(items, lineH)) {
    let prev: Item | null = null;
    for (const it of rowsInOrder(block)) {
      if (prev) {
        const gap = it.g.left - prev.g.right;
        if (sameRow(prev.g, it.g) && gap >= -0.2 * prev.g.height && gap < 1.5 * Math.min(prev.g.height, it.g.height)) {
          const joined = joinLine(prev.line, it.line);
          out[out.length - 1] = joined;
          prev = { line: joined, g: geoOf(joined, width, height, theta) };
          continue;
        }
      }
      out.push(it.line);
      prev = it;
    }
  }
  return out;
}

// ---------- scraps of a neighbouring page ----------

/**
 * Lines from the edge of a facing page (a magazine spread shot without a
 * crop): a narrow block of lines touching the left or right edge of the
 * photo, most of which start or end in the middle of a word. Only used when
 * no crop was set; the main text is never touched.
 */
export function dropEdgeFragments(lines: OcrLine[], width = 1, height = 1): OcrLine[] {
  if (lines.length < 3) return lines;
  const edge = 0.01;
  const touchesLeft = (l: OcrLine) => l.box.x <= edge;
  const touchesRight = (l: OcrLine) => l.box.x + l.box.width >= 1 - edge;
  const inner = lines.filter((l) => !touchesLeft(l) && !touchesRight(l));
  if (inner.length === 0) return lines;
  const mainWidth = median(inner.map((l) => l.box.width * width));
  const startsMidWord = (t: string) => /^\s*(?:\p{Ll}|\p{L}{1,3}['’]s?\s)/u.test(t);
  const endsMidWord = (t: string) => /[\p{L}-]$/u.test(t.trim());
  const drop = new Set<OcrLine>();
  for (const [side, test, midWord] of [
    ['left', touchesLeft, startsMidWord],
    ['right', touchesRight, endsMidWord],
  ] as const) {
    void side;
    const block = lines.filter(test);
    if (block.length === 0) continue;
    const narrow = median(block.map((l) => l.box.width * width)) < 0.75 * mainWidth;
    const cut = block.filter((l) => midWord(l.text)).length / block.length;
    if (narrow && cut >= 0.5) block.forEach((l) => drop.add(l));
  }
  void height;
  return drop.size ? lines.filter((l) => !drop.has(l)) : lines;
}

/**
 * The lines of one page in reading order, the same for every way a page
 * comes in (camera with or without a found page, a photo, a file, a PDF
 * page): scraps of a facing page dropped when no crop was set, then
 * `orderLines`.
 */
export function readingOrder(lines: OcrLine[], width: number, height: number, opts: { cropped: boolean }): OcrLine[] {
  return orderLines(opts.cropped ? lines : dropEdgeFragments(lines, width, height), width, height);
}

// ---------- paragraphs ----------

/** Print when most line heights sit within PRINT_HEIGHT_SPREAD of the median; handwriting otherwise. */
export function looksPrinted(heights: number[]): boolean {
  if (heights.length < 2) return true;
  const m = median(heights);
  if (!(m > 0)) return true;
  const close = heights.filter((h) => Math.abs(h - m) <= PRINT_HEIGHT_SPREAD * m).length;
  return close / heights.length >= 0.8;
}

/** Lines in reading order to paragraphs. */
export function groupParagraphs(lines: OcrLine[], width = 1, height = 1): Paragraph[] {
  if (lines.length === 0) return [];
  const theta = pageAngle(lines, width, height);
  const boxes = lines.map((l) => geoOf(l, width, height, theta));
  const h = median(boxes.map((b) => b.height)) || 1;
  const gapLimit = (looksPrinted(boxes.map((b) => b.height)) ? PARAGRAPH_GAP_PRINT : PARAGRAPH_GAP) * h;
  const paragraphs: Paragraph[] = [];
  let current: OcrLine[] = [lines[0]];
  let left = boxes[0].left;
  let right = boxes[0].right;

  for (let i = 1; i < lines.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    const prevText = lines[i - 1].text.trim();
    const text = lines[i].text.trim();
    const gap = b.top - a.bottom;
    const ratio = Math.max(a.height, b.height) / Math.max(1e-9, Math.min(a.height, b.height));
    const widest = Math.max(right, b.right) - Math.min(left, b.left);
    // A first line indented and the next one flush left is still one paragraph.
    const firstLineIndent = current.length === 1 && a.left - b.left > 0.8 * h && a.left - b.left < 5 * h;
    // A wrapped continuation of an item ("and blanched" under "4 POUND haricots
    // verts, stems removed"): indented, starting in lowercase, after a line
    // with no closing punctuation.
    const continuation = b.left > left && /^\p{Ll}/u.test(text) && !/[.!?:;]$/.test(prevText) && gap < gapLimit;

    const breakHere =
      gap >= gapLimit || // more space than lines of one paragraph have (relative to this page's writing)
      b.top < a.top - 0.5 * h || // went back up: another column or block
      ratio > 1.45 || // a heading and its text
      LIST_MARKER.test(lines[i].text) || // a new list item
      (!continuation && !firstLineIndent && current.length > 1 && b.left - left > 1.2 * h) || // an indented first line
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
