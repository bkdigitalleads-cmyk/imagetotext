/**
 * The one job: images in, text out. Picking photos and files, cropping and
 * rotating, reading each page with Vision on the device, and saving the
 * pages to a document. No network anywhere in here.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { documentBounds, flatten, groupParagraphs, isHandwritten, readingOrder, recognize, recognizeRegions, renderPdf, sharpness, unknownWords, OcrLine, Quad } from '../modules/vision-ocr';
import { addPages, createDoc, getDoc, Page, PageInput, PageOrigin, replacePage, setDocTitle } from './db';
import { keepPage, removeFiles } from './files';
import { buildRuns, cleanText, modelText, Run } from './text';
import {
  autoDetectLanguage,
  clampQuad,
  latinOnly,
  maskOffScript,
  mergeSecondPass,
  nudgeCounts,
  offScript,
  orderQuad,
  pickSecondPass,
  readingLanguages,
  SECOND_PASS_SCALE,
  shouldNudge,
  unturnQuad,
  usablePage,
  wholePhoto,
} from './accuracy';

/** An image ready to crop and read: a local file and its pixel size. */
export interface Source {
  uri: string;
  width: number;
  height: number;
  /** A page drawn from a PDF: already flat, so no page detection. */
  pdf?: boolean;
  /**
   * A crop was set: a found page, or one the person adjusted. Without one,
   * scraps of a facing page at the photo's edges are dropped.
   */
  cropped?: boolean;
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
      sources.push(...pdf.pages.map((pg) => ({ ...pg, pdf: true })));
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
  /**
   * The page's own outline, in pixels of the turned image, when one was
   * found (or the person dragged its corners). It wins over the rectangle:
   * the page is cut out along it and squared up before reading.
   */
  quad?: Quad | null;
}

/** What page detection found: a page outline, the whole photo already (a screenshot, a scan), or nothing usable. */
export type PageFind = { kind: 'page'; quad: Quad } | { kind: 'whole' } | { kind: 'none' };

/**
 * The page in a photo, when Vision finds one it is confident about, as an
 * outline on the unturned photo. PDF pages are whole already.
 */
export async function detectPage(src: Source): Promise<PageFind> {
  if (src.pdf) return { kind: 'whole' };
  const found = await documentBounds(src.uri);
  if (!found.quad || !found.width || !found.height) return { kind: 'none' };
  // The corners are in the pixels Vision saw; bring them to the size we know.
  const sx = src.width / found.width;
  const sy = src.height / found.height;
  const quad = orderQuad(found.quad.map((p) => ({ x: p.x * sx, y: p.y * sy })));
  if (wholePhoto({ ...found, quad }, src)) return { kind: 'whole' };
  if (!usablePage({ ...found, quad }, src)) return { kind: 'none' };
  return { kind: 'page', quad: clampQuad(quad, src) };
}

/** The size of an image after `turns` quarter turns. */
export function turnedSize(s: { width: number; height: number }, turns: number) {
  return turns % 2 ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/**
 * Applies the crop and rotation at full resolution. With a page outline the
 * page is cut out along it and squared up (perspective correction), then
 * turned. No change means no new file. `cropped` says a crop was set (a
 * found page, or one the person adjusted), for the reading order.
 */
export async function applyCrop(src: Source, crop: Crop | null, cropped = false): Promise<Source> {
  const out = await cropImage(src, crop);
  return cropped ? { ...out, cropped } : out;
}

async function cropImage(src: Source, crop: Crop | null): Promise<Source> {
  if (!crop) return src;
  if (crop.quad) {
    const flat = await flatten(src.uri, unturnQuad(crop.quad, src, crop.turns));
    if (crop.turns % 4 === 0) return flat;
    const turned = await ImageManipulator.manipulate(flat.uri).rotate((crop.turns % 4) * 90).renderAsync();
    const saved = await turned.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  }
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
 * One page read: Vision on the whole (flattened) image, then a second, closer
 * look at the lines it was unsure of or that are small print (enlarged crops,
 * read again all at once). A second reading replaces a line only when it is
 * more confident. The added time is logged. Then the words the dictionary
 * does not know are marked (for the hard-to-read note, whose numbers are
 * logged per page), and the lines are put in reading order.
 */
async function readPage(src: Source, languages: string[]): Promise<{ lines: OcrLine[]; width: number; height: number }> {
  // Exactly the reading languages from Settings (English by default); Vision
  // guesses the language only when more than one is picked.
  const autoDetect = autoDetectLanguage(languages);
  const latin = latinOnly(readingLanguages(languages));
  const first = await recognize(src.uri, { languages, autoDetectLanguage: autoDetect, languageCorrection: true });
  const width = first.width || src.width;
  const height = first.height || src.height;
  let lines = first.lines;
  console.log(`[ocr] reader: ${first.reader ?? 'lines'}, ${lines.length} lines, languages ${readingLanguages(languages).join(', ')}, guess ${autoDetect ? 'on' : 'off'}`);
  const picks = pickSecondPass(lines, undefined, { latinOnly: latin });
  if (picks.length > 0) {
    const started = Date.now();
    try {
      const again = await recognizeRegions(
        src.uri,
        picks.map((i) => lines[i].box),
        // A closer look never guesses the language for a Latin-only list.
        { languages, autoDetectLanguage: autoDetect && !latin, languageCorrection: true, scale: SECOND_PASS_SCALE }
      );
      const merged = mergeSecondPass(lines, again.results.map((r, k) => ({ index: picks[k], ...r })), { latinOnly: latin });
      const replaced = merged.filter((l, i) => l !== lines[i]).length;
      lines = merged;
      console.log(
        `[ocr] second pass: ${picks.length} of ${first.lines.length} lines, ${replaced} replaced, ` +
          `${Date.now() - started} ms (native ${Math.round(again.elapsedMs)} ms)`
      );
    } catch {
      // the first reading stands
    }
  }
  if (latin) {
    // The last guard: no letters from another alphabet in a Latin-only reading.
    lines = lines.map((l) => {
      if (!offScript(l.text)) return l;
      console.log(`[ocr] other alphabet in a Latin-only reading, shown as "?": "${l.text}"`);
      return { ...l, text: maskOffScript(l.text), alternatives: l.alternatives.map(maskOffScript), confidence: Math.min(l.confidence, 0.3) };
    });
  }
  const unknown = await unknownWords(lines.map((l) => l.text), languages[0] ?? 'en-US');
  lines = lines.map((l, i) => ({ ...l, unknown: unknown[i] ?? [] }));
  const n = nudgeCounts(lines);
  console.log(
    `[ocr] unsure words: ${n.unsure} of ${n.words} (${Math.round(n.share * 100)}%; low at first look ${n.lowFirstLook}, ` +
      `not in the dictionary ${n.notInDictionary}), note ${shouldNudge(lines) ? 'yes' : 'no'} (over 15% and at least 3)`
  );
  const wordsIn = countTokens(lines);
  let dropped = 0;
  const ordered = readingOrder(lines, width, height, {
    cropped: src.cropped === true,
    onDrop: (l) => {
      dropped += countTokens([l]);
      console.log(`[ocr] dropped a scrap at the photo's edge (no crop set): "${l.text}"`);
    },
  });
  // Reading order only moves, cuts and joins lines; it never loses a word.
  const wordsOut = countTokens(ordered);
  console.log(
    `[ocr] words: ${wordsIn} read, ${wordsOut} kept${dropped ? `, ${dropped} in edge scraps` : ''}` +
      `${wordsOut + dropped !== wordsIn ? ' (MISMATCH)' : ''}; ${isHandwritten(ordered, width, height) ? 'handwriting' : 'print'}`
  );
  return { lines: ordered, width, height };
}

const countTokens = (lines: OcrLine[]) => lines.reduce((t, l) => t + (l.text.match(/\S+/g) ?? []).length, 0);

/**
 * Reads each image and saves it as a page, into `docId` or a new document.
 * Pages with no text are still saved (so the order holds), but only pages
 * with text count as recognitions. With `replacePageId` (Retake) the first
 * image takes that page's place instead.
 */
export async function readIntoDoc(
  sources: Source[],
  opts: {
    docId: number | null;
    languages: string[];
    keepOriginals: boolean;
    origin: PageOrigin;
    replacePageId?: number | null;
    onPage?: (done: number) => void;
  }
): Promise<ReadResult> {
  const pages: PageInput[] = [];
  let read = 0;
  let empty = 0;
  const list = opts.replacePageId != null ? sources.slice(0, 1) : sources;
  for (const [i, src] of list.entries()) {
    const sharp = await sharpness(src.uri);
    const page = await readPage(src, opts.languages);
    const files = await keepPage(src.uri, opts.keepOriginals);
    pages.push({ ...files, ...page, origin: opts.origin, sharpness: sharp });
    if (page.lines.length > 0) read++;
    else empty++;
    opts.onPage?.(i + 1);
  }
  let docId = opts.docId;
  if (opts.replacePageId != null && docId != null && pages[0]) {
    removeFiles(await replacePage(opts.replacePageId, pages[0]));
  } else {
    docId = docId ?? (await createDoc());
    await addPages(docId, pages);
  }
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
  return buildRuns(pageParagraphs(page), clean, { handwritten: isHandwritten(page.lines, page.width || 1, page.height || 1) });
}

/** A page's text exactly as shown: their edit, or the recognized text, cleaned up or not. */
export function pageText(page: Page, clean: boolean): string {
  if (page.editedText != null) return clean ? cleanText(page.editedText) : page.editedText;
  return modelText(buildRuns(pageParagraphs(page), clean, { handwritten: isHandwritten(page.lines, page.width || 1, page.height || 1) }));
}

/** The whole document as one text: pages in order, a blank line between. */
export function docText(pages: Page[], clean: boolean): string {
  return pages
    .map((p) => pageText(p, clean).trim())
    .filter(Boolean)
    .join('\n\n');
}
