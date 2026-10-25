// Image to Text's on-device OCR: Apple Vision (Swift, ios/) plus the
// TypeScript helpers that turn its lines into paragraphs.
export * from './src/VisionOcr.types';
export {
  documentBounds,
  flatten,
  focusAt,
  isAvailable,
  recognize,
  recognizeRegions,
  renderPdf,
  sharpness,
  supportedLanguages,
  OcrUnavailableError,
} from './src/VisionOcrModule';
export { flipVisionBox, groupParagraphs, LIST_MARKER, orderLines, PARAGRAPH_GAP, paragraphText } from './src/paragraphs';
export type { Paragraph } from './src/paragraphs';
