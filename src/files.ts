/**
 * Page images on the device: the app's documents folder, scans/. Rows in
 * the database keep only file names (db.ts says why). Nothing here ever
 * leaves the phone.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const THUMB_WIDTH = 360;

function scansDir(): Directory {
  const dir = new Directory(Paths.document, 'scans');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const newName = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A file name in scans/ to a URI an Image can show, or null for ''. */
export function scanUri(name: string): string | null {
  return name ? new File(scansDir(), name).uri : null;
}

/**
 * Keeps a page: a small thumbnail always, and the full image too when
 * `keepOriginal` is on. Returns the file names ('' for what was not kept).
 */
export async function keepPage(sourceUri: string, keepOriginal: boolean): Promise<{ image: string; thumb: string }> {
  const dir = scansDir();
  const base = newName();
  const thumbRef = await ImageManipulator.manipulate(sourceUri).resize({ width: THUMB_WIDTH }).renderAsync();
  const thumbSaved = await thumbRef.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const thumb = `${base}-thumb.jpg`;
  new File(thumbSaved.uri).moveSync(new File(dir, thumb));
  let image = '';
  if (keepOriginal) {
    image = `${base}.jpg`;
    new File(sourceUri).copySync(new File(dir, image));
  }
  return { image, thumb };
}

/** Deletes page files by name. Missing files are fine. */
export function removeFiles(names: string[]): void {
  const dir = scansDir();
  for (const n of names) {
    if (!n) continue;
    try {
      const f = new File(dir, n);
      if (f.exists) f.delete();
    } catch {
      // already gone
    }
  }
}

/** Writes text to a file in the cache folder for sharing, and returns its URI. */
export function writeShareFile(name: string, text: string): string {
  const dir = new Directory(Paths.cache, 'export');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const f = new File(dir, name);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  return f.uri;
}

/** Moves a finished file (the printed PDF) into the export folder under a readable name. */
export function nameForShare(uri: string, name: string): string {
  const dir = new Directory(Paths.cache, 'export');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  new File(uri).moveSync(dest);
  return dest.uri;
}
