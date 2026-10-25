import { requireOptionalNativeModule } from 'expo';
import type {
  DocumentBounds,
  OcrBox,
  OcrResult,
  Quad,
  RecognizeOptions,
  RegionsResult,
  RenderedPage,
  RenderPdfOptions,
  RenderPdfResult,
} from './VisionOcr.types';

interface NativeVisionOcr {
  recognize(uri: string, options: RecognizeOptions): Promise<OcrResult>;
  supportedLanguages(): Promise<string[]>;
  renderPdf(uri: string, options: RenderPdfOptions): Promise<RenderPdfResult>;
  documentBounds(uri: string): Promise<{ found: boolean; confidence: number; method: string; corners: number[]; width: number; height: number }>;
  flatten(uri: string, options: { corners: number[] }): Promise<RenderedPage>;
  recognizeRegions(uri: string, options: RecognizeOptions & { boxes: number[]; scale: number }): Promise<RegionsResult>;
  sharpness(uri: string, options: { region: number[]; size: number }): Promise<number>;
  focusAt(x: number, y: number, hold: number): Promise<boolean>;
}

// Optional so the JS still loads where the native side is missing (web
// renders, a build without the module); every call then says so plainly.
const Native = requireOptionalNativeModule<NativeVisionOcr>('VisionOcr');

export class OcrUnavailableError extends Error {
  constructor() {
    super('Text recognition is not available in this build.');
    this.name = 'OcrUnavailableError';
  }
}

export function isAvailable(): boolean {
  return Native != null;
}

/** Reads the text in an image file on the device. Lines come back in Vision's order. */
export async function recognize(uri: string, options: RecognizeOptions = {}): Promise<OcrResult> {
  if (!Native) throw new OcrUnavailableError();
  return Native.recognize(uri, {
    languages: options.languages ?? ['en-US'],
    autoDetectLanguage: options.autoDetectLanguage ?? true,
    languageCorrection: options.languageCorrection ?? true,
    candidates: options.candidates ?? 3,
  });
}

/** Languages Vision can read on this iPhone (accurate level). */
export async function supportedLanguages(): Promise<string[]> {
  if (!Native) return ['en-US'];
  try {
    return await Native.supportedLanguages();
  } catch {
    return ['en-US'];
  }
}

/** Draws a PDF's pages as JPEG files in the cache folder, up to maxPages. */
export async function renderPdf(uri: string, options: RenderPdfOptions = {}): Promise<RenderPdfResult> {
  if (!Native) throw new OcrUnavailableError();
  return Native.renderPdf(uri, { maxPages: options.maxPages ?? 50, longEdge: options.longEdge ?? 2400 });
}

/**
 * The page in a photo, as four corners. Document segmentation first, then
 * rectangle detection. Never throws: no page (or no native module) is `found: false`.
 */
export async function documentBounds(uri: string): Promise<DocumentBounds> {
  const none: DocumentBounds = { found: false, confidence: 0, method: 'none', quad: null, width: 0, height: 0 };
  if (!Native) return none;
  try {
    const r = await Native.documentBounds(uri);
    const c = r.corners;
    if (!r.found || c.length !== 8) return { ...none, width: r.width, height: r.height };
    const quad: Quad = [
      { x: c[0], y: c[1] },
      { x: c[2], y: c[3] },
      { x: c[4], y: c[5] },
      { x: c[6], y: c[7] },
    ];
    const method = r.method === 'segmentation' || r.method === 'rectangle' ? r.method : 'none';
    return { found: true, confidence: r.confidence, method, quad, width: r.width, height: r.height };
  } catch {
    return none;
  }
}

/** Cuts the page out along its corners and squares it up, at full resolution (a new JPEG). */
export async function flatten(uri: string, quad: Quad): Promise<RenderedPage> {
  if (!Native) throw new OcrUnavailableError();
  return Native.flatten(uri, { corners: quad.flatMap((p) => [p.x, p.y]) });
}

/**
 * Reads the given line boxes again from enlarged crops of the image, all at
 * once. Results come back in the same order as `boxes`.
 */
export async function recognizeRegions(uri: string, boxes: OcrBox[], options: RecognizeOptions & { scale?: number } = {}): Promise<RegionsResult> {
  if (!Native) throw new OcrUnavailableError();
  if (boxes.length === 0) return { elapsedMs: 0, results: [] };
  return Native.recognizeRegions(uri, {
    boxes: boxes.flatMap((b) => [b.x, b.y, b.width, b.height]),
    languages: options.languages ?? ['en-US'],
    autoDetectLanguage: options.autoDetectLanguage ?? true,
    languageCorrection: options.languageCorrection ?? true,
    candidates: options.candidates ?? 3,
    scale: options.scale ?? 2,
  });
}

/**
 * How sharp a photo, or a region of it (fractions, top-left origin), is: the
 * variance of the Laplacian on a small grayscale copy. Higher is sharper.
 * Null when it cannot be measured.
 */
export async function sharpness(uri: string, region?: OcrBox): Promise<number | null> {
  if (!Native) return null;
  try {
    const r = region ? [region.x, region.y, region.width, region.height] : [];
    const v = await Native.sharpness(uri, { region: r, size: 512 });
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Focus and expose the back camera at a point in the camera's own
 * coordinates (see focusPoint in src/accuracy.ts), held for `holdSeconds`,
 * then back to continuous autofocus. False when the camera is not there.
 */
export async function focusAt(x: number, y: number, holdSeconds: number): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.focusAt(x, y, holdSeconds);
  } catch {
    return false;
  }
}
