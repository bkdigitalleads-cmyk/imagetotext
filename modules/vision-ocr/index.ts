// Image to Text's on-device OCR: Apple Vision (Swift, ios/) plus the
// TypeScript helpers that turn its lines into paragraphs.
export * from './src/VisionOcr.types';
export { isAvailable, recognize, renderPdf, supportedLanguages, OcrUnavailableError } from './src/VisionOcrModule';
export { groupParagraphs, orderLines, paragraphText } from './src/paragraphs';
export type { Paragraph } from './src/paragraphs';
