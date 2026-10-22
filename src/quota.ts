/**
 * The free tier, as pure functions (no imports), checked by `npm test`.
 *  - 3 recognitions a day (one recognized page is one recognition; a page
 *    where nothing was found does not count)
 *  - batches of up to 2 pages
 *  - no export files and no Clean up (gated in the screens)
 * Pro removes all of it. The day is the phone's local calendar day.
 */

export const FREE_DAILY_RECOGNITIONS = 3;
export const FREE_MAX_PAGES = 2;

export interface QuotaRecord {
  /** Local day, YYYY-MM-DD. */
  day: string;
  used: number;
}

/** The local calendar day of a time, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The stored record, or a fresh one when it is missing or unreadable. */
export function parseQuota(raw: string | null | undefined): QuotaRecord {
  if (!raw) return { day: '', used: 0 };
  try {
    const r = JSON.parse(raw);
    const used = Number(r?.used);
    return {
      day: typeof r?.day === 'string' ? r.day : '',
      used: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
    };
  } catch {
    return { day: '', used: 0 };
  }
}

/** Recognitions used on `today`. A record from any other day counts as none. */
export function usedOn(rec: QuotaRecord, today: string): number {
  return rec.day === today ? rec.used : 0;
}

/** Recognitions left today. Pro has no limit. */
export function remainingToday(rec: QuotaRecord, today: string, isPro: boolean): number {
  if (isPro) return Infinity;
  return Math.max(0, FREE_DAILY_RECOGNITIONS - usedOn(rec, today));
}

/** The record after `n` more recognitions today. */
export function consume(rec: QuotaRecord, today: string, n: number): QuotaRecord {
  return { day: today, used: usedOn(rec, today) + Math.max(0, Math.floor(n)) };
}

export type Gate = 'ok' | 'limit' | 'batch';

/**
 * Whether one more page can be read into a document that already has
 * `pages` pages: 'batch' when a free document is full, 'limit' when today's
 * free recognitions are used up.
 */
export function gateNewPage(opts: { isPro: boolean; pages: number; remaining: number }): Gate {
  if (opts.isPro) return 'ok';
  if (opts.pages >= FREE_MAX_PAGES) return 'batch';
  if (opts.remaining <= 0) return 'limit';
  return 'ok';
}

/** How many pages can be added in one go (for the photo picker's limit, PDF pages). Pro: no limit. */
export function pagesAllowed(opts: { isPro: boolean; pages: number; remaining: number }): number {
  if (opts.isPro) return Infinity;
  return Math.max(0, Math.min(FREE_MAX_PAGES - opts.pages, opts.remaining));
}
