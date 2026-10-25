// Image to Text's on-device OCR: Apple Vision (Swift, ios/) plus the
// TypeScript helpers that turn its lines into paragraphs.
export * from './src/VisionOcr.types';
export {
  documentBounds,
  flatten,
  focusAt,
  isAvailable,
  isTestBuild,
  recognize,
  recognizeRegions,
  renderPdf,
  sharpness,
  supportedLanguages,
  unknownWords,
  OcrUnavailableError,
} from './src/VisionOcrModule';
export { dropEdgeFragments, flipVisionBox, groupParagraphs, LIST_MARKER, orderLines, PARAGRAPH_GAP, paragraphText, readingOrder } from './src/paragraphs';
export type { Paragraph } from './src/paragraphs';
