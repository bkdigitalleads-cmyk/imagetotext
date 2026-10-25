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
/** ...or when more than this share of the words the dictionary can check are unknown to it (garbled, however confident). */
export const NUDGE_UNKNOWN_SHARE = 0.3;
/** A found page outline is used only at this confidence or more. */
export const PAGE_MIN_CONFIDENCE = 0.6;
/** ...and only if it covers at least this share of the photo. */
export const PAGE_MIN_AREA = 0.15;
/** An outline covering more than this share is the whole photo already (a screenshot, a scan): keep the plain crop. */
export const PAGE_MAX_AREA = 0.97;

/**
 * Below this sharpness (variance of the Laplacian on a 512 px grayscale
 * copy) a photo counts as blurry. A first guess from typical values (sharp
 * printed or handwritten pages score in the hundreds or more, soft ones in
 * the tens); every capture logs its number so it can be tuned on device.
 */
export const BLUR_THRESHOLD = 100;
/** A tap holds focus and exposure at its point this long, then autofocus goes back to continuous. */
export const FOCUS_HOLD_SECONDS = 3;

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
 * confident. The original line box and corners are kept; the words come
 * from the reading that won, so a tapped word still finds its place on the
 * page. The first look's confidence is kept too: a line Vision had to read
 * twice still counts toward the hard-to-read note.
 */
export function mergeSecondPass(lines: OcrLine[], readings: SecondReading[]): OcrLine[] {
  const out = lines.slice();
  for (const r of readings) {
    const line = out[r.index];
    if (!line || !r.text.trim() || !(r.confidence > line.confidence)) continue;
    const { unknown: _stale, ...kept } = line;
    void _stale;
    out[r.index] = {
      ...kept,
      text: r.text,
      confidence: r.confidence,
      words: r.words,
      alternatives: r.alternatives,
      firstConfidence: line.firstConfidence ?? line.confidence,
    };
  }
  return out;
}

// ---------- the nudge ----------
//
// Vision's line confidence is coarse on the device (mostly 1.0, 0.5 or
// 0.3), and the second pass lifts most low lines to 1.0, so build 2's
// note (low lines after the second pass) never showed. A word now counts
// as unsure when:
//  - its line was read below SECOND_PASS_CONFIDENCE at the first look
//    (before any second reading replaced it), or
//  - the phone's dictionary does not know it AND Vision was not fully sure
//    of it (its line under 1.0, or the runner-up reading of the line has a
//    different word there).
// The note shows when more than NUDGE_UNSURE_SHARE of the words are unsure,
// or when more than NUDGE_UNKNOWN_SHARE of the words the dictionary checked
// are unknown to it (garbled text read with false confidence).

type NudgeLine = Pick<OcrLine, 'text' | 'confidence'> & Partial<Pick<OcrLine, 'alternatives' | 'firstConfidence' | 'unknown'>>;

const isWord = (w: string) => /[\p{L}\p{N}]/u.test(w);
const bareWord = (w: string) => w.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** A word the dictionary check looks at (the same rule as the native side): three or more letters, no capital first letter unless all capitals. */
const checkable = (w: string) => {
  const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  return word.length >= 3 && /^\p{L}+$/u.test(word) && !(/^\p{Lu}/u.test(word) && word !== word.toLocaleUpperCase());
};

export interface NudgeCounts {
  /** Tokens with a letter or digit. */
  words: number;
  /** Words on lines read below SECOND_PASS_CONFIDENCE at the first look. */
  lowFirstLook: number;
  /** Words the dictionary does not know, on a line Vision was not fully sure of or where its runner-up differs. */
  unknownUnsure: number;
  /** Words the dictionary checked, and how many it did not know. */
  checked: number;
  unknown: number;
  /** Words counted unsure (each word once). */
  unsure: number;
  share: number;
}

/** What the hard-to-read note is decided from, per page; logged after every read. */
export function nudgeCounts(lines: NudgeLine[]): NudgeCounts {
  const c: NudgeCounts = { words: 0, lowFirstLook: 0, unknownUnsure: 0, checked: 0, unknown: 0, unsure: 0, share: 0 };
  for (const l of lines) {
    const tokens = l.text.match(/\S+/g) ?? [];
    const low = (l.firstConfidence ?? l.confidence) < SECOND_PASS_CONFIDENCE;
    const unknown = new Set(l.unknown ?? []);
    const runnerUp = l.alternatives?.[0];
    const runnerWords = runnerUp != null ? new Set(runnerUp.split(/\s+/).map(bareWord)) : null;
    tokens.forEach((t, k) => {
      if (checkable(t)) {
        c.checked++;
        if (unknown.has(k)) c.unknown++;
      }
      if (!isWord(t)) return;
      c.words++;
      const torn = runnerWords != null && !runnerWords.has(bareWord(t));
      const unknownUnsure = unknown.has(k) && (l.confidence < 1 || torn);
      if (low) c.lowFirstLook++;
      if (unknownUnsure) c.unknownUnsure++;
      if (low || unknownUnsure) c.unsure++;
    });
  }
  c.share = c.words === 0 ? 0 : c.unsure / c.words;
  return c;
}

/** Share of a page's words that count as unsure (see above). */
export function unsureShare(lines: NudgeLine[]): number {
  return nudgeCounts(lines).share;
}

/** Whether the Result screen should say the photo was hard to read. */
export function shouldNudge(lines: NudgeLine[]): boolean {
  const c = nudgeCounts(lines);
  if (c.words === 0) return false;
  return c.share > NUDGE_UNSURE_SHARE || (c.checked >= 10 && c.unknown / c.checked > NUDGE_UNKNOWN_SHARE);
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

/** A confident outline that covers the whole photo: a screenshot or a scan, nothing to crop. */
export function wholePhoto(found: { found: boolean; confidence: number; quad: Quad | null }, size: { width: number; height: number }): boolean {
  if (!found.found || !found.quad || found.confidence < PAGE_MIN_CONFIDENCE) return false;
  return quadArea(orderQuad(found.quad)) / Math.max(1, size.width * size.height) > PAGE_MAX_AREA;
}

/** When no page is found, the corner handles start this share in from each edge. */
export const GUESS_INSET = 0.06;

/**
 * Where the corner handles start when no page was found: on `rect` (the
 * camera's page guide) when given, otherwise GUESS_INSET in from each edge.
 */
export function guessQuad(size: { width: number; height: number }, rect?: { x: number; y: number; width: number; height: number }): Quad {
  const r = rect ?? {
    x: size.width * GUESS_INSET,
    y: size.height * GUESS_INSET,
    width: size.width * (1 - 2 * GUESS_INSET),
    height: size.height * (1 - 2 * GUESS_INSET),
  };
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
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

// ---------- focus and blur ----------

/** Whether a sharpness number means the photo is too soft to read well. Unknown is not blurry. */
export function isBlurry(sharpness: number | null | undefined): boolean {
  return sharpness != null && sharpness > 0 && sharpness < BLUR_THRESHOLD;
}

/**
 * A tap on the camera preview as a point in the camera's own coordinates:
 * (0, 0) top left and (1, 1) bottom right with the phone landscape, home
 * side right. The preview fills the view (aspect fill) with a portrait
 * photo `photoAspect` wide for 1 tall (4:3 sensor, held upright: 0.75).
 */
export function focusPoint(tap: Point, view: { width: number; height: number }, photoAspect = 0.75): Point {
  let u: number;
  let v: number;
  if (view.width / view.height < photoAspect) {
    // The photo is wider than the view: full height, cropped at the sides.
    const shownW = view.height * photoAspect;
    u = (tap.x + (shownW - view.width) / 2) / shownW;
    v = tap.y / view.height;
  } else {
    const shownH = view.width / photoAspect;
    u = tap.x / view.width;
    v = (tap.y + (shownH - view.height) / 2) / shownH;
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  // Portrait to the sensor's landscape: the camera's x runs down the screen, its y runs right to left.
  return { x: clamp(v), y: clamp(1 - u) };
}
