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
  box: OcrBox;
  words: OcrWord[];
  /** Vision's next-best readings of the same line, best first. */
  alternatives: string[];
}

export interface OcrResult {
  /** Pixel size of the image as shown (orientation applied). */
  width: number;
  height: number;
  lines: OcrLine[];
}

export interface RecognizeOptions {
  /** BCP 47 codes, most likely first. en-US is always added. */
  languages?: string[];
  /** iOS 16 and later. */
  autoDetectLanguage?: boolean;
  languageCorrection?: boolean;
  /** Readings per line; extra ones come back as alternatives. */
  candidates?: number;
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
