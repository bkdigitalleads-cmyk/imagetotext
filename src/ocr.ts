/**
 * The one job: images in, text out. Picking photos and files, cropping and
 * rotating, reading each page with Vision on the device, and saving the
 * pages to a document. No network anywhere in here.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { groupParagraphs, orderLines, recognize, renderPdf, OcrLine } from '../modules/vision-ocr';
import { addPages, createDoc, getDoc, Page, PageInput, setDocTitle } from './db';
import { keepPage } from './files';
import { buildRuns, cleanText, modelText, Run } from './text';

/** An image ready to crop and read: a local file and its pixel size. */
export interface Source {
  uri: string;
  width: number;
  height: number;
}

// ---------- picking ----------

/** Photos from the library, in the order picked. `limit` 0 means no limit. */
export async function pickPhotos(limit: number): Promise<Source[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit !== 1,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

/**
 * Images and PDFs from Files. Each PDF page becomes an image (drawn on the
 * phone). `limit` caps the pages returned (0 = no limit); `skipped` says how
 * many were left out by it.
 */
export async function pickFiles(limit: number): Promise<{ sources: Source[]; skipped: number }> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return { sources: [], skipped: 0 };
  const cap = limit > 0 ? limit : Infinity;
  const sources: Source[] = [];
  let skipped = 0;
  for (const a of res.assets) {
    const isPdf = a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.name);
    const room = cap - sources.length;
    if (isPdf) {
      if (room <= 0) {
        skipped++;
        continue;
      }
      const pdf = await renderPdf(a.uri, { maxPages: Number.isFinite(room) ? room : 200 });
      sources.push(...pdf.pages);
      skipped += Math.max(0, pdf.pageCount - pdf.pages.length);
    } else if (room > 0) {
      sources.push(await measure(a.uri));
    } else {
      skipped++;
    }
  }
  return { sources, skipped };
}

/** A picked file's pixel size (the document picker does not say). */
async function measure(uri: string): Promise<Source> {
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  return { uri, width: ref.width, height: ref.height };
}

// ---------- crop and rotate ----------

export interface Crop {
  /** Quarter turns clockwise, 0 to 3. */
  turns: number;
  /** In pixels of the turned image. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size of an image after `turns` quarter turns. */
export function turnedSize(s: { width: number; height: number }, turns: number) {
  return turns % 2 ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/** Applies the crop and rotation at full resolution. No change means no new file. */
export async function applyCrop(src: Source, crop: Crop | null): Promise<Source> {
  if (!crop) return src;
  const size = turnedSize(src, crop.turns);
  const full = crop.x <= 0 && crop.y <= 0 && crop.width >= size.width && crop.height >= size.height;
  if (crop.turns % 4 === 0 && full) return src;
  let ctx = ImageManipulator.manipulate(src.uri);
  if (crop.turns % 4) ctx = ctx.rotate((crop.turns % 4) * 90);
  if (!full) {
    ctx = ctx.crop({
      originX: Math.max(0, Math.round(crop.x)),
      originY: Math.max(0, Math.round(crop.y)),
      width: Math.round(Math.min(crop.width, size.width - Math.max(0, crop.x))),
      height: Math.round(Math.min(crop.height, size.height - Math.max(0, crop.y))),
    });
  }
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

// ---------- reading ----------

export interface ReadResult {
  docId: number;
  /** Pages that had text and were counted. */
  read: number;
  /** Pages where nothing was found (not counted against the free ones). */
  empty: number;
}

/**
 * Reads each image with Vision and saves it as a page, into `docId` or a
 * new document. Pages with no text are still saved (so the order holds),
 * but only pages with text count as recognitions.
 */
export async function readIntoDoc(
  sources: Source[],
  opts: { docId: number | null; languages: string[]; keepOriginals: boolean; onPage?: (done: number) => void }
): Promise<ReadResult> {
  const pages: PageInput[] = [];
  let read = 0;
  let empty = 0;
  for (const [i, src] of sources.entries()) {
    const res = await recognize(src.uri, { languages: opts.languages, autoDetectLanguage: true, languageCorrection: true });
    const lines = orderLines(res.lines, res.width || src.width, res.height || src.height);
    const files = await keepPage(src.uri, opts.keepOriginals);
    pages.push({ ...files, width: res.width || src.width, height: res.height || src.height, lines });
    if (lines.length > 0) read++;
    else empty++;
    opts.onPage?.(i + 1);
  }
  const docId = opts.docId ?? (await createDoc());
  await addPages(docId, pages);
  const doc = await getDoc(docId);
  if (doc) await setDocTitle(docId, docText(doc.pages, doc.cleanUp));
  return { docId, read, empty };
}

// ---------- text of a page and a document ----------

/** A page's lines grouped into paragraphs. */
export function pageParagraphs(page: Page): OcrLine[][] {
  return groupParagraphs(page.lines, page.width || 1, page.height || 1).map((p) => p.lines);
}

/** The words of an unedited page, ready to draw. Null once the person has edited it. */
export function pageRuns(page: Page, clean: boolean): Run[] | null {
  if (page.editedText != null) return null;
  return buildRuns(pageParagraphs(page), clean);
}

/** A page's text exactly as shown: their edit, or the recognized text, cleaned up or not. */
export function pageText(page: Page, clean: boolean): string {
  if (page.editedText != null) return clean ? cleanText(page.editedText) : page.editedText;
  return modelText(buildRuns(pageParagraphs(page), clean));
}

/** The whole document as one text: pages in order, a blank line between. */
export function docText(pages: Page[], clean: boolean): string {
  return pages
    .map((p) => pageText(p, clean).trim())
    .filter(Boolean)
    .join('\n\n');
}
