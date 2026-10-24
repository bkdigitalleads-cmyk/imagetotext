// Image to Text's on-device OCR: Apple Vision (Swift, ios/) plus the
// TypeScript helpers that turn its lines into paragraphs.
export * from './src/VisionOcr.types';
export {
  documentBounds,
  flatten,
  isAvailable,
  recognize,
  recognizeRegions,
  renderPdf,
  supportedLanguages,
  OcrUnavailableError,
} from './src/VisionOcrModule';
export { groupParagraphs, orderLines, paragraphText } from './src/paragraphs';
export type { Paragraph } from './src/paragraphs';
