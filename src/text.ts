/**
 * Everything the app does to recognized text, as pure functions (no React,
 * no native modules, no runtime imports), so `npm test` can check them:
 *  - Clean up: join broken lines into paragraphs, fix double spaces
 *  - safe fixes on recognized text (a lone "I" that is a 1, pieced fractions)
 *  - the page model the Result screen draws (tappable words, unsure words)
 *  - word counts, titles, file names, and the .txt and .md exports
 */
import type { OcrBox, OcrLine } from '../modules/vision-ocr/src/VisionOcr.types';

// ---------- Clean up ----------

/** A list item: dash, bullet, checkbox, or "1." "2)" "a)". Kept identical to LIST_MARKER in the paragraph grouping. */
export const LIST_MARKER =
  /^\s*(?:[-\u2013\u2014\u2022*\u00b7\u25aa\u25e6\u25cb\u25a1\u2610\u2611\u2612\u2713\u2714](?:\s+(?=\S)|(?=[\p{L}"'(]))|\[[ xX\u2713]?\]\s*\S|\d{1,3}[.)]\s+\S|[a-zA-Z][.)]\s+\S)/u;

/** A word cut at the end of a line ("infor-") that the next line finishes in lowercase. */
const HYPHEN_END = /\p{L}-$/u;
const STARTS_LOWER = /^\p{Ll}/u;

/** Joins two lines of one paragraph: a hyphen-cut word is rejoined, otherwise one space. */
function joinPair(a: string, b: string): string {
  if (HYPHEN_END.test(a) && STARTS_LOWER.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/** One line with tabs and runs of spaces as single spaces, ends trimmed, stray space before , and . removed. */
function tidyLine(line: string): string {
  return line
    .replace(/[\t   ]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.])(?= |$)/g, '$1')
    .trim();
}

/**
 * Clean up: lines inside a paragraph become one line, paragraphs stay
 * apart (a blank line between them), list items keep their own lines,
 * spaces are single. Running it twice changes nothing.
 */
export function cleanText(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t ]*\n+/)
    .map((block) =>
      block
        .split('\n')
        .map(tidyLine)
        .filter((l) => l.length > 0)
    )
    .filter((lines) => lines.length > 0);

  return blocks
    .map((lines) => {
      const out: string[] = [];
      for (const line of lines) {
        if (out.length === 0 || LIST_MARKER.test(line)) out.push(line);
        else out[out.length - 1] = joinPair(out[out.length - 1], line);
      }
      return out.join('\n');
    })
    .join('\n\n');
}

// ---------- safe fixes on recognized text ----------
//
// Applied to every recognized line, raw or cleaned up, never to the person's
// own edits. Only fixes that cannot change a correct reading: a lone "I" or
// "l" that stands where a quantity must be, and fractions Vision returns in
// pieces turned into the single fraction character. Nothing is guessed: a
// "%" where a fraction might have been stays a "%".

/** Fractions that have their own character. */
const FRACTIONS: Record<string, string> = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘',
  '1/6': '⅙', '5/6': '⅚', '1/7': '⅐', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞', '1/9': '⅑', '1/10': '⅒',
};
const FRACTION_GLYPHS = Object.values(FRACTIONS).join('');
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/** Units written in capitals, the way recipes and labels print them. */
const CAPS_UNIT = /^(?:CUPS?|TABLESPOONS?|TEASPOONS?|TBSPS?|TSPS?|POUNDS?|LBS?|OUNCES?|OZ|PINTS?|QUARTS?|GALLONS?|GRAMS?|KG|ML|LITERS?|LITRES?|INCH(?:ES)?|CLOVES?)(?![A-Za-z])/;
/** A fraction on its own: a fraction character, or digits, a slash, digits. */
const FRACTION_TOKEN = new RegExp(`^(?:[${FRACTION_GLYPHS}]|[0-9]{1,2}/[0-9]{1,2}(?![0-9]))`);
const PIECED_FRACTION = new RegExp(
  `(?<![0-9${SUPERSCRIPT}])([0-9${SUPERSCRIPT}]{1,2})\u2044([0-9${SUBSCRIPT}]{1,2})|(?<![0-9${SUPERSCRIPT}])([${SUPERSCRIPT}]{1,2})/([0-9${SUBSCRIPT}]{1,2})`,
  'g'
);

const plainDigits = (s: string) =>
  s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, (c) => String(SUPERSCRIPT.includes(c) ? SUPERSCRIPT.indexOf(c) : SUBSCRIPT.indexOf(c)));

/**
 * Fractions Vision returns in pieces ("1⁄2" with a fraction slash, "¹/₂" in
 * small digits) as one fraction character ("½"), or as plain "n/d" when no
 * such character exists. A plain "3/4" typed with a slash is left as it is.
 */
export function normalizeFractions(s: string): string {
  return s.replace(PIECED_FRACTION, (_m, a, b, c, d) => {
    const key = `${plainDigits(a ?? c)}/${plainDigits(b ?? d)}`;
    return FRACTIONS[key] ?? key;
  });
}

/**
 * One recognized word, fixed where it is safe, given the word after it:
 *  - a lone "I" or "l" before a unit in capitals ("I TABLESPOON") or before a
 *    fraction ("I ½ CUPS") is the number 1
 *  - "I-INCH" and "I½" start with the number 1
 *  - pieced fractions become one fraction character
 */
export function fixToken(token: string, next?: string): string {
  let t = normalizeFractions(token);
  if ((t === 'I' || t === 'l') && next != null) {
    const n = normalizeFractions(next).replace(/^[([]/, '');
    if (CAPS_UNIT.test(n) || FRACTION_TOKEN.test(n)) t = '1';
  }
  return t
    .replace(/^([([]?)[Il](?=-(?:INCH(?:ES)?|IN)(?![A-Za-z]))/, '$11')
    .replace(new RegExp(`^([([]?)[Il](?=[${FRACTION_GLYPHS}])`), '$11');
}

/** A recognized line with the safe fixes, spacing kept exactly. */
export function fixLine(text: string): string {
  const tokens = [...text.matchAll(/\S+/g)];
  if (tokens.length === 0) return text;
  let out = '';
  let last = 0;
  tokens.forEach((m, i) => {
    out += text.slice(last, m.index) + fixToken(m[0], tokens[i + 1]?.[0]);
    last = (m.index ?? 0) + m[0].length;
  });
  return out + text.slice(last);
}

// ---------- the page model ----------

/** Vision line confidence below this marks every word in the line as unsure. */
export const LOW_LINE_CONFIDENCE = 0.4;

export interface Run {
  /** The word as shown. */
  text: string;
  /** What follows it: a space, a line break, a blank line, or nothing. */
  after: string;
  /** Index into the page's ordered lines, for the source crop. */
  line: number;
  /** The word's box in the image, or null when Vision gave none (then use the line's box). */
  box: OcrBox | null;
  /** Shown with a faint underline. */
  unsure: boolean;
}

const bare = (w: string) => w.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Unsure means: the whole line read with low confidence, or the runner-up
 * reading of the line does not have this word (Vision was torn about it).
 */
export function isUnsure(token: string, line: Pick<OcrLine, 'confidence' | 'alternatives'>): boolean {
  const word = bare(token);
  if (!word) return false;
  if (line.confidence < LOW_LINE_CONFIDENCE) return true;
  const runnerUp = line.alternatives[0];
  if (runnerUp == null) return false;
  return !runnerUp.split(/\s+/).some((w) => bare(w) === word);
}

function tokenBox(line: OcrLine, start: number, end: number): OcrBox | null {
  let box: OcrBox | null = null;
  for (const w of line.words) {
    if (w.start < end && w.end > start) {
      if (!box) box = { ...w.box };
      else {
        const x = Math.min(box.x, w.box.x);
        const y = Math.min(box.y, w.box.y);
        box = {
          x,
          y,
          width: Math.max(box.x + box.width, w.box.x + w.box.width) - x,
          height: Math.max(box.y + box.height, w.box.y + w.box.height) - y,
        };
      }
    }
  }
  return box;
}

/**
 * The words of a page, paragraph by paragraph, with what goes between
 * them. Raw keeps the page's own line breaks and spacing; Clean up joins
 * lines and uses single spaces. `modelText` of the result is exactly what
 * Copy, Share and Export use, and matches cleanText(rawText) when clean.
 */
export function buildRuns(paragraphs: OcrLine[][], clean: boolean): Run[] {
  const runs: Run[] = [];
  let lineIndex = 0;
  paragraphs.forEach((lines, p) => {
    lines.forEach((line, li) => {
      const index = lineIndex++;
      const text = clean ? line.text.replace(/[\t   ]/g, ' ') : line.text;
      const tokens = [...text.matchAll(/\S+/g)];
      const start = runs.length;
      let lastEnd = 0;
      tokens.forEach((m, k) => {
        const at = m.index ?? 0;
        if (runs.length > start) runs[runs.length - 1].after = clean ? ' ' : text.slice(lastEnd, at);
        const tokenText = fixToken(m[0], tokens[k + 1]?.[0]);
        // A lone comma or period gets pulled onto the word before it.
        if (clean && (tokenText === ',' || tokenText === '.') && runs.length > start) runs[runs.length - 1].after = '';
        runs.push({
          text: tokenText,
          after: '',
          line: index,
          box: tokenBox(line, at, at + m[0].length),
          unsure: isUnsure(m[0], line),
        });
        lastEnd = at + m[0].length;
      });
      if (runs.length === start) return; // a line of nothing but spaces
      const last = runs[runs.length - 1];
      const nextLine = lines[li + 1];
      if (nextLine) {
        if (!clean) last.after = text.slice(lastEnd) + '\n';
        else if (LIST_MARKER.test(nextLine.text)) last.after = '\n';
        else if (HYPHEN_END.test(last.text) && STARTS_LOWER.test(nextLine.text.trimStart())) {
          last.text = last.text.slice(0, -1);
          last.after = '';
        } else last.after = ' ';
      } else if (p < paragraphs.length - 1) {
        last.after = (clean ? '' : text.slice(lastEnd)) + '\n\n';
      } else {
        last.after = clean ? '' : text.slice(lastEnd);
      }
    });
  });
  return runs;
}

export function modelText(runs: Run[]): string {
  return runs.map((r) => r.text + r.after).join('');
}

/** The page as recognized (with the safe fixes): each line as it was, a blank line between paragraphs. */
export function rawText(paragraphs: OcrLine[][]): string {
  return paragraphs.map((lines) => lines.map((l) => fixLine(l.text)).join('\n')).join('\n\n');
}

// ---------- counts, titles, file names ----------

/** Words with at least one letter or digit in them. */
export function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function copiedLine(words: number): string {
  return `Copied. ${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}.`;
}

/** The first line with any letters or digits, for the history list. */
export function firstLine(text: string, max = 80): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** A file name from the first line ("Meeting notes Oct 22"), or "Scan 2026-10-22". No extension. */
export function fileBaseName(text: string, day: string): string {
  const raw = firstLine(text, 200)
    .replace(/…$/, '')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!raw) return `Scan ${day}`;
  if (raw.length <= 48) return raw;
  const cut = raw.slice(0, 48);
  const space = cut.lastIndexOf(' ');
  return (space > 24 ? cut.slice(0, space) : cut).trim();
}

// ---------- exports ----------

/** .txt: the pages one after another, a blank line between. */
export function toTxt(pages: string[]): string {
  return pages.map((p) => p.trim()).filter(Boolean).join('\n\n') + '\n';
}

/** Escapes what Markdown would otherwise turn into formatting, keeping list items as lists. */
export function mdEscape(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let l = line.replace(/([\\`*_[\]<>])/g, '\\$1');
      // The escaping above turned "* item" into "\* item"; a list item stays a list item.
      l = l.replace(/^(\s*)\\\*(\s+\S)/, '$1*$2');
      if (/^\s*#{1,6}(\s|$)/.test(l)) l = l.replace('#', '\\#');
      if (/^\s*(?:-{3,}|={3,})\s*$/.test(l)) l = '\\' + l.trimStart();
      if (/^\s*\+\s/.test(l)) l = l.replace('+', '\\+');
      return l;
    })
    .join('\n');
}

/** .md: the pages as paragraphs, a rule between pages. */
export function toMarkdown(pages: string[]): string {
  return pages.map((p) => mdEscape(p.trim())).filter(Boolean).join('\n\n---\n\n') + '\n';
}

/** For the PDF: HTML-safe text. */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- reordering ----------

/** The list with one item moved, for page reordering. Out-of-range indexes are clamped. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}
