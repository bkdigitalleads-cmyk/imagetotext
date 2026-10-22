/**
 * Everything the app does to recognized text, as pure functions (no React,
 * no native modules, no runtime imports), so `npm test` can check them:
 *  - Clean up: join broken lines into paragraphs, fix double spaces
 *  - the page model the Result screen draws (tappable words, unsure words)
 *  - word counts, titles, file names, and the .txt and .md exports
 */
import type { OcrBox, OcrLine } from '../modules/vision-ocr/src/VisionOcr.types';

// ---------- Clean up ----------

/** A list item: "- ", "• ", "* ", "1. ", "2) ", "a) ". Same rule as the paragraph grouping. */
const LIST_MARKER = /^\s*(?:[-•*·]|\d{1,3}[.)]|[a-zA-Z][.)])\s+\S/;

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
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      const start = runs.length;
      let lastEnd = 0;
      while ((m = re.exec(text))) {
        if (runs.length > start) runs[runs.length - 1].after = clean ? ' ' : text.slice(lastEnd, m.index);
        const tokenText = m[0];
        // A lone comma or period gets pulled onto the word before it.
        if (clean && (tokenText === ',' || tokenText === '.') && runs.length > start) runs[runs.length - 1].after = '';
        runs.push({
          text: tokenText,
          after: '',
          line: index,
          box: tokenBox(line, m.index, m.index + tokenText.length),
          unsure: isUnsure(tokenText, line),
        });
        lastEnd = m.index + tokenText.length;
      }
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

/** The page as recognized: each line as it was, a blank line between paragraphs. */
export function rawText(paragraphs: OcrLine[][]): string {
  return paragraphs.map((lines) => lines.map((l) => l.text).join('\n')).join('\n\n');
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
