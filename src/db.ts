/**
 * On-device SQLite store. Times are epoch ms. Image files live in the app's
 * documents folder (files.ts); rows keep only their file names, because the
 * folder's full path changes when iOS updates the app.
 *
 * After launch the schema only grows: never drop or rename a column or
 * table. A new column goes in as a new step in migrate() below, guarded by
 * PRAGMA user_version, so it runs once on every existing install.
 */
import * as SQLite from 'expo-sqlite';
import type { OcrLine } from '../modules/vision-ocr';
import { firstLine } from './text';

const SCHEMA_VERSION = 2;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('imagetotext.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS docs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT '',
          clean_up INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id INTEGER NOT NULL,
          position INTEGER NOT NULL,
          image TEXT NOT NULL DEFAULT '',
          thumb TEXT NOT NULL DEFAULT '',
          width INTEGER NOT NULL DEFAULT 0,
          height INTEGER NOT NULL DEFAULT 0,
          lines_json TEXT NOT NULL DEFAULT '[]',
          edited_text TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pages_doc ON pages(doc_id, position);
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      await migrate(db);
      return db;
    })();
    // A failed open is retried on the next call instead of failing forever.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  // Version 1 is the tables above. Each later step runs once on existing installs.
  if (version < 2) {
    // Build 2: where a page came from (for Retake) and whether its "hard to read" note was shown.
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(pages)');
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('origin')) await db.execAsync("ALTER TABLE pages ADD COLUMN origin TEXT NOT NULL DEFAULT ''");
    if (!has('nudge_seen')) await db.execAsync('ALTER TABLE pages ADD COLUMN nudge_seen INTEGER NOT NULL DEFAULT 0');
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// ---------- settings (key/value) ----------

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
}

/** Every stored key with this prefix, prefix removed. */
export async function kvAll(prefix: string): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key LIKE ?', [
    prefix + '%',
  ]);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key.slice(prefix.length)] = r.value;
  return out;
}

// ---------- documents and pages ----------

export interface Page {
  id: number;
  docId: number;
  position: number;
  /** File name in the scans folder; '' when the original was not kept. */
  image: string;
  thumb: string;
  width: number;
  height: number;
  /** Recognized lines in reading order. */
  lines: OcrLine[];
  /** The person's own edit of this page's text, or null while it is as recognized. */
  editedText: string | null;
  /** How the page came in, so Retake goes back to the same place. '' for pages from build 1. */
  origin: PageOrigin;
  /** The "hard to read" note was already shown for this page. */
  nudgeSeen: boolean;
}

export type PageOrigin = 'scan' | 'photos' | 'files' | '';

export interface Doc {
  id: number;
  title: string;
  cleanUp: boolean;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
}

/** A history row: enough for the list without loading every page. */
export interface DocSummary {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  thumb: string;
}

function parseLines(json: string): OcrLine[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToPage(r: any): Page {
  return {
    id: r.id,
    docId: r.doc_id,
    position: r.position,
    image: r.image ?? '',
    thumb: r.thumb ?? '',
    width: r.width ?? 0,
    height: r.height ?? 0,
    lines: parseLines(r.lines_json ?? '[]'),
    editedText: r.edited_text ?? null,
    origin: r.origin === 'scan' || r.origin === 'photos' || r.origin === 'files' ? r.origin : '',
    nudgeSeen: r.nudge_seen === 1,
  };
}

export interface PageInput {
  image: string;
  thumb: string;
  width: number;
  height: number;
  lines: OcrLine[];
  origin: PageOrigin;
}

export async function createDoc(): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const res = await db.runAsync('INSERT INTO docs (title, clean_up, created_at, updated_at) VALUES (?, 0, ?, ?)', ['', now, now]);
  return res.lastInsertRowId;
}

/** Adds pages at the end of a document, in order. */
export async function addPages(docId: number, pages: PageInput[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ n: number | null }>('SELECT MAX(position) AS n FROM pages WHERE doc_id = ?', [docId]);
    let pos = (row?.n ?? -1) + 1;
    for (const p of pages) {
      await db.runAsync(
        `INSERT INTO pages (doc_id, position, image, thumb, width, height, lines_json, edited_text, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [docId, pos++, p.image, p.thumb, Math.round(p.width), Math.round(p.height), JSON.stringify(p.lines), p.origin, now, now]
      );
    }
  });
}

export async function getDoc(id: number): Promise<Doc | null> {
  const db = await getDb();
  const d = await db.getFirstAsync<any>('SELECT * FROM docs WHERE id = ?', [id]);
  if (!d) return null;
  const rows = await db.getAllAsync<any>('SELECT * FROM pages WHERE doc_id = ? ORDER BY position ASC, id ASC', [id]);
  return {
    id: d.id,
    title: d.title ?? '',
    cleanUp: d.clean_up === 1,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    pages: rows.map(rowToPage),
  };
}

/** Newest first. */
export async function getDocSummaries(): Promise<DocSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT d.id, d.title, d.created_at, d.updated_at,
       (SELECT COUNT(*) FROM pages p WHERE p.doc_id = d.id) AS page_count,
       (SELECT p.thumb FROM pages p WHERE p.doc_id = d.id ORDER BY p.position ASC, p.id ASC LIMIT 1) AS thumb
     FROM docs d ORDER BY d.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pageCount: r.page_count ?? 0,
    thumb: r.thumb ?? '',
  }));
}

export async function countPages(docId: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pages WHERE doc_id = ?', [docId]);
  return row?.n ?? 0;
}

/** The history line for a document, from its current text. */
export async function setDocTitle(docId: number, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE docs SET title = ?, updated_at = ? WHERE id = ?', [firstLine(text), Date.now(), docId]);
}

export async function setDocCleanUp(docId: number, on: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE docs SET clean_up = ?, updated_at = ? WHERE id = ?', [on ? 1 : 0, Date.now(), docId]);
}

/** null puts the page back to the text as recognized. */
export async function setPageText(pageId: number, text: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE pages SET edited_text = ?, updated_at = ? WHERE id = ?', [text, Date.now(), pageId]);
}

/**
 * Retake: a new photo and reading in place of a page, same position, edits
 * and the note reset. Returns the old file names so the caller can delete them.
 */
export async function replacePage(pageId: number, p: PageInput): Promise<string[]> {
  const db = await getDb();
  const old = await db.getFirstAsync<any>('SELECT image, thumb FROM pages WHERE id = ?', [pageId]);
  await db.runAsync(
    `UPDATE pages SET image = ?, thumb = ?, width = ?, height = ?, lines_json = ?, edited_text = NULL, origin = ?,
       nudge_seen = 0, updated_at = ? WHERE id = ?`,
    [p.image, p.thumb, Math.round(p.width), Math.round(p.height), JSON.stringify(p.lines), p.origin, Date.now(), pageId]
  );
  return old ? [old.image, old.thumb].filter(Boolean) : [];
}

/** The "hard to read" note has been shown for this page; it does not come back. */
export async function markNudgeSeen(pageId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE pages SET nudge_seen = 1 WHERE id = ?', [pageId]);
}

/** Saves a new page order: `ids` from first to last. */
export async function reorderPages(docId: number, ids: number[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [i, id] of ids.entries()) {
      await db.runAsync('UPDATE pages SET position = ? WHERE id = ? AND doc_id = ?', [i, id, docId]);
    }
    await db.runAsync('UPDATE docs SET updated_at = ? WHERE id = ?', [Date.now(), docId]);
  });
}

/** Removes a page; returns its file names so the caller can delete the files. */
export async function deletePage(pageId: number): Promise<string[]> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>('SELECT image, thumb FROM pages WHERE id = ?', [pageId]);
  await db.runAsync('DELETE FROM pages WHERE id = ?', [pageId]);
  return row ? [row.image, row.thumb].filter(Boolean) : [];
}

/** Removes a document and its pages; returns the file names to delete. */
export async function deleteDoc(docId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT image, thumb FROM pages WHERE doc_id = ?', [docId]);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pages WHERE doc_id = ?', [docId]);
    await db.runAsync('DELETE FROM docs WHERE id = ?', [docId]);
  });
  return rows.flatMap((r) => [r.image, r.thumb]).filter(Boolean);
}

/** Every document and page. Settings and purchases stay. Returns the file names to delete. */
export async function deleteAllDocs(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT image, thumb FROM pages');
  await db.execAsync('DELETE FROM pages; DELETE FROM docs;');
  return rows.flatMap((r) => [r.image, r.thumb]).filter(Boolean);
}

export async function countDocs(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM docs');
  return row?.n ?? 0;
}
