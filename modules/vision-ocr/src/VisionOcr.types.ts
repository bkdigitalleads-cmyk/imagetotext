/** A box as fractions of the image (0 to 1), origin at the top left. */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A word Vision found inside a line: UTF-16 offsets into the line text, and its box. */
export interface OcrWord {
  start: number;
  end: number;
  box: OcrBox;
}

export interface OcrLine {
  text: string;
  /** Vision's confidence for the whole line, 0 to 1. */
  confidence: number;
  /** The upright box around the line. */
  box: OcrBox;
  /**
   * The line's own corners when it sits at an angle: top-left x, y,
   * top-right, bottom-right, bottom-left, as fractions, origin top left.
   * Missing on pages read before build 3.
   */
  corners?: number[];
  words: OcrWord[];
  /** Vision's next-best readings of the same line, best first. */
  alternatives: string[];
  /**
   * Vision's confidence at the first look, when a second, closer reading
   * replaced the line. Missing when the first reading stood (and on pages
   * read before build 3).
   */
  firstConfidence?: number;
  /**
   * The words (by position among the line's space-separated tokens) the
   * phone's dictionary does not know. Missing on pages read before build 3.
   */
  unknown?: number[];
  /**
   * From the document reader (iOS 26 and later): the line's place in
   * Vision's own reading order, its paragraph (-1 for list items, tables
   * and loose text), and whether Vision says it wraps into the next line.
   * Missing from line reading and on pages read before build 4.
   */
  order?: number;
  para?: number;
  wraps?: boolean;
}

export interface OcrResult {
  /** Pixel size of the image as shown (orientation applied). */
  width: number;
  height: number;
  lines: OcrLine[];
  /** Which reader ran: "document" (iOS 26 and later) or "lines". */
  reader?: 'document' | 'lines';
}

export interface RecognizeOptions {
  /** BCP 47 codes, most likely first. en-US is always added. */
  languages?: string[];
  /** iOS 16 and later. */
  autoDetectLanguage?: boolean;
  languageCorrection?: boolean;
  /** Readings per line; extra ones come back as alternatives. */
  candidates?: number;
  /** iOS 26 and later: use the document reader (default true). */
  documentReader?: boolean;
}

export interface RenderedPage {
  uri: string;
  width: number;
  height: number;
}

export interface RenderPdfOptions {
  maxPages?: number;
  longEdge?: number;
}

export interface RenderPdfResult {
  /** Pages in the file, which can be more than were rendered. */
  pageCount: number;
  pages: RenderedPage[];
}

/** A point in pixels of the image as shown, origin at the top left. */
export interface Point {
  x: number;
  y: number;
}

/** A page outline: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface DocumentBounds {
  found: boolean;
  /** Vision's confidence in the outline, 0 to 1. */
  confidence: number;
  /** Which request found it. */
  method: 'segmentation' | 'rectangle' | 'none';
  quad: Quad | null;
  /** Pixel size of the image the corners refer to. */
  width: number;
  height: number;
}

/** One region read again in the second pass. Empty text means nothing was found. */
export interface RegionReading {
  text: string;
  confidence: number;
  /** Word boxes in fractions of the whole page. */
  words: OcrWord[];
  alternatives: string[];
}

export interface RegionsResult {
  /** Time the native side spent, crops and reading included. */
  elapsedMs: number;
  results: RegionReading[];
}
