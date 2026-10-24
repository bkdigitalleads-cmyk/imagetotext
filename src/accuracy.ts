/**
 * Reading accuracy, as pure functions (no runtime imports), checked by
 * `npm test`:
 *  - which lines get a second, closer look, and how its readings are merged
 *  - when the Result screen says a photo was hard to read
 *  - page outlines: corner order, rotation, and whether a found page is worth using
 */
import type { OcrLine, OcrWord, Point, Quad } from '../modules/vision-ocr/src/VisionOcr.types';

/** Lines Vision read with less confidence than this get a second pass, and their words count as unsure for the nudge. */
export const SECOND_PASS_CONFIDENCE = 0.6;
/** Lines shorter than this share of the image height get a second pass (small print). */
export const SMALL_LINE_HEIGHT = 0.012;
/** At most this many lines per page get a second pass. */
export const SECOND_PASS_MAX_LINES = 40;
/** How much each second-pass crop is enlarged. */
export const SECOND_PASS_SCALE = 2;
/** The nudge shows when more than this share of a page's words are unsure. */
export const NUDGE_UNSURE_SHARE = 0.1;
/** A found page outline is used only at this confidence or more. */
export const PAGE_MIN_CONFIDENCE = 0.6;
/** ...and only if it covers at least this share of the photo. */
export const PAGE_MIN_AREA = 0.15;
/** An outline covering more than this share is the whole photo already (a screenshot, a scan): keep the plain crop. */
export const PAGE_MAX_AREA = 0.97;

// ---------- second pass ----------

/**
 * Indexes of the lines to read again: low confidence or small print. The
 * least confident and smallest go first when there are more than the cap;
 * the result is in line order.
 */
export function pickSecondPass(lines: Pick<OcrLine, 'confidence' | 'box' | 'text'>[], max = SECOND_PASS_MAX_LINES): number[] {
  const picked = lines
    .map((l, i) => ({ i, l }))
    .filter(({ l }) => l.text.trim().length > 0 && (l.confidence < SECOND_PASS_CONFIDENCE || l.box.height < SMALL_LINE_HEIGHT))
    .sort((a, b) => a.l.confidence - b.l.confidence || a.l.box.height - b.l.box.height || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map(({ i }) => i);
  return picked.sort((a, b) => a - b);
}

export interface SecondReading {
  /** Index into the lines the second pass was asked about. */
  index: number;
  text: string;
  confidence: number;
  words: OcrWord[];
  alternatives: string[];
}

/**
 * The lines with second-pass readings swapped in where they are more
 * confident. The original line box is kept; the words come from the reading
 * that won, so a tapped word still finds its place on the page.
 */
export function mergeSecondPass(lines: OcrLine[], readings: SecondReading[]): OcrLine[] {
  const out = lines.slice();
  for (const r of readings) {
    const line = out[r.index];
    if (!line || !r.text.trim() || !(r.confidence > line.confidence)) continue;
    out[r.index] = { text: r.text, confidence: r.confidence, box: line.box, words: r.words, alternatives: r.alternatives };
  }
  return out;
}

// ---------- the nudge ----------

const isWord = (w: string) => /[\p{L}\p{N}]/u.test(w);

/** Share of a page's words (tokens with a letter or digit) on lines read below the confidence threshold. */
export function unsureShare(lines: Pick<OcrLine, 'text' | 'confidence'>[]): number {
  let total = 0;
  let unsure = 0;
  for (const l of lines) {
    const n = (l.text.match(/\S+/g) ?? []).filter(isWord).length;
    total += n;
    if (l.confidence < SECOND_PASS_CONFIDENCE) unsure += n;
  }
  return total === 0 ? 0 : unsure / total;
}

/** Whether the Result screen should say the photo was hard to read. */
export function shouldNudge(lines: Pick<OcrLine, 'text' | 'confidence'>[]): boolean {
  return unsureShare(lines) > NUDGE_UNSURE_SHARE;
}

// ---------- page outlines ----------

/** Any four points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(points: Point[]): Quad {
  const p = points.slice(0, 4);
  const bySum = [...p].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => a.x - a.y - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

/** Area of a four-sided outline (shoelace). */
export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** True when every corner turns the same way (no bow tie, no dent). */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Whether a found page outline is worth preselecting: confident enough,
 * a real share of the photo but not all of it, and a proper four-sided shape.
 */
export function usablePage(found: { found: boolean; confidence: number; quad: Quad | null }, size: { width: number; height: number }): boolean {
  if (!found.found || !found.quad || found.confidence < PAGE_MIN_CONFIDENCE) return false;
  const q = orderQuad(found.quad);
  if (!isConvex(q)) return false;
  const share = quadArea(q) / Math.max(1, size.width * size.height);
  return share >= PAGE_MIN_AREA && share <= PAGE_MAX_AREA;
}

/** Corners kept inside the image. */
export function clampQuad(q: Quad, size: { width: number; height: number }): Quad {
  return q.map((p) => ({ x: Math.min(size.width, Math.max(0, p.x)), y: Math.min(size.height, Math.max(0, p.y)) })) as Quad;
}

/**
 * The outline after the image turns a quarter clockwise. `size` is the
 * image before the turn. Corners are reordered for the new orientation.
 */
export function turnQuad(q: Quad, size: { width: number; height: number }): Quad {
  return orderQuad(q.map((p) => ({ x: size.height - p.y, y: p.x })));
}

/**
 * An outline drawn on the image turned `turns` quarters clockwise, back on
 * the original image (`size` is the original, unturned).
 */
export function unturnQuad(q: Quad, size: { width: number; height: number }, turns: number): Quad {
  let pts: Point[] = q;
  let w = turns % 2 ? size.height : size.width;
  let h = turns % 2 ? size.width : size.height;
  for (let k = 0; k < ((turns % 4) + 4) % 4; k++) {
    // Undo one clockwise quarter turn: (x, y) on the turned image came from (y, w - x).
    pts = pts.map((p) => ({ x: p.y, y: w - p.x }));
    [w, h] = [h, w];
  }
  return orderQuad(pts);
}

/** The smallest rectangle around an outline. */
export function quadBounds(q: Quad): { x: number; y: number; width: number; height: number } {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
