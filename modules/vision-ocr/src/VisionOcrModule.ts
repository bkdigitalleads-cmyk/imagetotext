import { requireOptionalNativeModule } from 'expo';
import type { OcrResult, RecognizeOptions, RenderPdfOptions, RenderPdfResult } from './VisionOcr.types';

interface NativeVisionOcr {
  recognize(uri: string, options: RecognizeOptions): Promise<OcrResult>;
  supportedLanguages(): Promise<string[]>;
  renderPdf(uri: string, options: RenderPdfOptions): Promise<RenderPdfResult>;
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
