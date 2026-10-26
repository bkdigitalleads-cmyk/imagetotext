/**
 * Reading accuracy, as pure functions (no runtime imports), checked by
 * `npm test`:
 *  - which lines get a second, closer look, and how its readings are merged
 *  - when the Result screen says a photo was hard to read
 *  - page outlines: corner order, rotation, and whether a found page is worth using
 */
import type { OcrLine, OcrWord, Point, Quad } from '../modules/vision-ocr/src/VisionOcr.types';

/** Lines Vision read with less confidence than this get a second pass, and their words not in the dictionary count as unsure for the nudge. */
export const SECOND_PASS_CONFIDENCE = 0.6;
/** Lines shorter than this share of the image height get a second pass (small print). */
export const SMALL_LINE_HEIGHT = 0.012;
/** At most this many lines per page get a second pass. */
export const SECOND_PASS_MAX_LINES = 40;
/** How much each second-pass crop is enlarged. */
export const SECOND_PASS_SCALE = 2;
/** The nudge shows when more than this share of a page's counted words are unsure... */
export const NUDGE_UNSURE_SHARE = 0.15;
/** ...and at least this many of them are. */
export const NUDGE_MIN_UNSURE = 3;
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

// ---------- reading languages ----------

/** Languages written in the Latin alphabet (BCP 47 primary subtags). */
const LATIN_LANGUAGES = new Set([
  'en', 'fr', 'it', 'de', 'es', 'pt', 'vi', 'nl', 'sv', 'da', 'nb', 'no', 'nn', 'fi', 'pl', 'cs', 'sk', 'tr', 'ro', 'hu',
  'id', 'ms', 'ca', 'hr', 'sl', 'et', 'lv', 'lt', 'is', 'ga', 'cy', 'eu', 'gl', 'af', 'sw', 'tl', 'fil', 'sq', 'az', 'uz',
]);

/** The languages actually read: the ones picked in Settings, English always among them. */
export function readingLanguages(picked: string[]): string[] {
  const list = picked.filter(Boolean);
  return list.includes('en-US') ? list : [...list, 'en-US'];
}

/**
 * Whether Vision should guess the language itself: only when the person
 * picked more than one. With English alone it guessed Arabic from a few
 * strokes of handwriting ("- Pay electric ط ا) ا"), so it reads exactly
 * the picked languages instead.
 */
export function autoDetectLanguage(picked: string[]): boolean {
  return readingLanguages(picked).length > 1;
}

/** Every reading language is written in the Latin alphabet. */
export function latinOnly(languages: string[]): boolean {
  return languages.length > 0 && languages.every((l) => LATIN_LANGUAGES.has(l.split('-')[0].toLowerCase()));
}

/** Letters outside the Latin alphabet, or digits other than 0 to 9. */
const OFF_SCRIPT = /(?![\p{Script=Latin}])\p{L}|(?![0-9])\p{Nd}/u;
const OFF_SCRIPT_ALL = /(?![\p{Script=Latin}])\p{L}|(?![0-9])\p{Nd}/gu;

/** True when a reading has characters no Latin-alphabet language uses. */
export function offScript(text: string): boolean {
  return OFF_SCRIPT.test(text);
}

/**
 * For a Latin-only language list, the last guard: any letter from another
 * alphabet still in a line becomes "?", one for one, so the text stays the
 * same length (word positions hold) and nothing reads as a wrong script.
 */
export function maskOffScript(text: string): string {
  return text.replace(OFF_SCRIPT_ALL, (c) => '?'.repeat(c.length));
}

// ---------- second pass ----------

/**
 * Indexes of the lines to read again: low confidence or small print. The
 * least confident and smallest go first when there are more than the cap;
 * the result is in line order.
 */
export function pickSecondPass(
  lines: Pick<OcrLine, 'confidence' | 'box' | 'text'>[],
  max = SECOND_PASS_MAX_LINES,
  opts: { latinOnly?: boolean } = {}
): number[] {
  const picked = lines
    .map((l, i) => ({ i, l }))
    .filter(
      ({ l }) =>
        l.text.trim().length > 0 &&
        (l.confidence < SECOND_PASS_CONFIDENCE || l.box.height < SMALL_LINE_HEIGHT || (opts.latinOnly === true && offScript(l.text)))
    )
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
 *
 * A second reading never loses words: one with fewer words than the first
 * is ignored (build 3 lost "fox jumps" that way), and so is one that has a
 * number run into a fraction ("1½", "11/2") the first reading did not have.
 *
 * With a Latin-only language list (`latinOnly`), a line holding another
 * alphabet is replaced by a reading without one, however confident, as
 * long as it keeps the Latin words; a reading with another alphabet never
 * replaces one without.
 */
export function mergeSecondPass(lines: OcrLine[], readings: SecondReading[], opts: { latinOnly?: boolean } = {}): OcrLine[] {
  const out = lines.slice();
  const latinWords = (t: string) => (t.match(/\S+/g) ?? []).filter((w) => !offScript(w)).length;
  for (const r of readings) {
    const line = out[r.index];
    if (!line || !r.text.trim()) continue;
    const fixesScript = opts.latinOnly === true && offScript(line.text) && !offScript(r.text);
    if (opts.latinOnly === true && offScript(r.text) && !offScript(line.text)) continue;
    if (fixesScript) {
      if (latinWords(r.text) < latinWords(line.text)) continue;
    } else {
      if (!(r.confidence > line.confidence)) continue;
      if (wordCount(r.text) < wordCount(line.text)) continue;
    }
    if (gluedFractions(r.text) > gluedFractions(line.text)) continue;
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

const wordCount = (t: string) => (t.match(/\S+/g) ?? []).length;
/** Numbers run straight into a fraction: "1½", "11/2", "1¹/₂". */
const gluedFractions = (t: string) => (t.match(/\d[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒¹²³⁴⁵⁶⁷⁸⁹]|\d{2,}[/\u2044]\d/g) ?? []).length;

// ---------- the nudge ----------
//
// Build 4's note showed on almost every handwritten scan, clean ones
// included: handwriting is often read at 0.5 at the first look even when
// every word comes out right. Build 5 counts a word as unsure only when
// BOTH hold:
//  - its line was read below SECOND_PASS_CONFIDENCE at the first look
//    (before any second reading replaced it), and
//  - it is not a dictionary word: the phone's dictionary, in the first
//    reading language, does not know it, or it mixes letters with digits
//    or symbols the way a garbled reading does ("2z", "8B", "cu9").
// List markers, single characters, numbers and punctuation are not counted
// at all; names with a capital (the dictionary often lacks them) and words
// with an apostrophe or a hyphen inside count as dictionary words. The
// note shows when more than NUDGE_UNSURE_SHARE of the counted words are
// unsure AND at least NUDGE_MIN_UNSURE of them are.

type NudgeLine = Pick<OcrLine, 'text' | 'confidence'> & Partial<Pick<OcrLine, 'firstConfidence' | 'unknown'>>;

/** An email address or web address: not a dictionary word, but not garbled either. */
const ADDRESS = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$|^(?:https?:\/\/|www\.)\S+$|^[\p{L}\p{N}-]+\.(?:com|org|net|edu|gov|io|co|uk)$/iu;

/**
 * How one token counts for the note: 'skip' (a list marker, a single
 * character, a number, punctuation), 'word' (a dictionary word, a name, an
 * address), or 'odd' (not a dictionary word). `unknown` says whether the
 * phone's dictionary flagged it (letters-only words).
 */
export function nudgeWordKind(token: string, unknown: boolean): 'skip' | 'word' | 'odd' {
  const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (core.length <= 1 || !/\p{L}/u.test(core)) return 'skip';
  if (/^\p{L}+$/u.test(core)) return unknown ? 'odd' : 'word';
  if (/^\p{L}+(?:['’-]\p{L}+)+$/u.test(core)) return 'word';
  if (ADDRESS.test(core)) return 'word';
  return 'odd';
}

export interface NudgeCounts {
  /** Words counted (list markers, single characters, numbers and punctuation left out). */
  words: number;
  /** Counted words on lines read below SECOND_PASS_CONFIDENCE at the first look. */
  lowFirstLook: number;
  /** Counted words that are not dictionary words. */
  notInDictionary: number;
  /** Both: the words that count as unsure. */
  unsure: number;
  share: number;
}

/** What the hard-to-read note is decided from, per page; logged after every read. */
export function nudgeCounts(lines: NudgeLine[]): NudgeCounts {
  const c: NudgeCounts = { words: 0, lowFirstLook: 0, notInDictionary: 0, unsure: 0, share: 0 };
  for (const l of lines) {
    const tokens = l.text.match(/\S+/g) ?? [];
    const low = (l.firstConfidence ?? l.confidence) < SECOND_PASS_CONFIDENCE;
    const unknown = new Set(l.unknown ?? []);
    tokens.forEach((t, k) => {
      const kind = nudgeWordKind(t, unknown.has(k));
      if (kind === 'skip') return;
      c.words++;
      if (low) c.lowFirstLook++;
      if (kind === 'odd') c.notInDictionary++;
      if (low && kind === 'odd') c.unsure++;
    });
  }
  c.share = c.words === 0 ? 0 : c.unsure / c.words;
  return c;
}

/** Share of a page's counted words that are unsure (see above). */
export function unsureShare(lines: NudgeLine[]): number {
  return nudgeCounts(lines).share;
}

/** Whether the Result screen should say the photo was hard to read. */
export function shouldNudge(lines: NudgeLine[]): boolean {
  const c = nudgeCounts(lines);
  return c.share > NUDGE_UNSURE_SHARE && c.unsure >= NUDGE_MIN_UNSURE;
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
