import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { initPurchases, getIsPro, checkPro, onProChange } from './purchases';
import { kvAll, kvGet, kvSet } from './db';
import { syncTrialReminder } from './reminder';
import { consume, dayKey, parseQuota, QuotaRecord, remainingToday } from './quota';
import { isTestBuild } from '../modules/vision-ocr';

export interface Settings {
  /** Reading languages, most likely first (BCP 47). en-US is always read as well. */
  languages: string[];
  /** Keep the full photo of each page (thumbnails and the source of a word need it). */
  keepOriginals: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  languages: ['en-US'],
  keepOriginals: true,
};

const SETTING_PREFIX = 'setting.';
export const ONBOARDED_KEY = 'flag.onboarded';
const QUOTA_KEY = 'quota.daily';
/** Test builds only: Pro is ignored on this phone while this is on. */
const ACT_FREE_KEY = 'test.actFree';
/**
 * A TestFlight or development build. The hidden test tools in Settings, and
 * the "act as a free user" override, exist only here: the App Store build
 * never shows them and ignores any stored override.
 */
export const TEST_BUILD = __DEV__ || isTestBuild();

/** Settings from their stored rows, with defaults for anything missing or unreadable. */
export function parseSettings(rows: Record<string, string>): Settings {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rows)) {
    try {
      raw[k] = JSON.parse(v);
    } catch {
      // one bad row falls back to its default
    }
  }
  const langs = Array.isArray(raw.languages)
    ? raw.languages.filter((l): l is string => typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)).slice(0, 8)
    : [];
  return {
    languages: langs.length > 0 ? langs : DEFAULT_SETTINGS.languages,
    keepOriginals: raw.keepOriginals !== false,
  };
}

/** Why the in-app paywall opened; it changes one line on it. */
export type PaywallReason = 'limit' | 'export' | 'cleanup' | 'batch' | 'pro';

interface AppState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  isPro: boolean;
  setIsPro: (v: boolean) => void;
  /** Test builds only (see TEST_BUILD). */
  testBuild: boolean;
  actFree: boolean;
  setActFree: (v: boolean) => Promise<void>;
  /** Test builds only: today's free scans back to the full count. */
  resetQuota: () => Promise<void>;
  paywall: PaywallReason | null;
  showPaywall: (reason: PaywallReason) => void;
  hidePaywall: () => void;
  /** Free recognitions left today (Infinity for Pro). */
  remaining: number;
  /** Counts `n` recognitions against today's free ones. */
  spendRecognitions: (n: number) => Promise<void>;
  ready: boolean;
  /** Bumped whenever documents change, so screens refetch. */
  dataVersion: number;
  bumpData: () => void;
  /** A one-line note at the bottom of the screen for a few seconds ("Copied. 412 words."). */
  notice: string | null;
  say: (text: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  // What the store says; isPro below is this unless a test build is acting as a free user.
  const [storePro, setIsPro] = useState(false);
  const [actFree, setActFreeState] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [quota, setQuota] = useState<QuotaRecord>({ day: '', used: 0 });
  const quotaRef = useRef(quota);
  const [today, setToday] = useState(dayKey(Date.now()));
  const [ready, setReady] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = parseSettings(await kvAll(SETTING_PREFIX));
        settingsRef.current = s;
        setSettings(s);
        const q = parseQuota(await kvGet(QUOTA_KEY));
        quotaRef.current = q;
        setQuota(q);
        if (TEST_BUILD) setActFreeState((await kvGet(ACT_FREE_KEY)) === '1');
      } catch {
        // unreadable storage -> defaults
      }
      try {
        await initPurchases();
        setIsPro(await getIsPro());
      } catch {
        setIsPro(false);
      }
      setReady(true);
    })();
  }, []);

  // Keep Pro in step with the store without a relaunch (renewals, expiries,
  // refunds), and re-check after a real trip to the background. The same
  // foreground check drops the trial reminder once the trial is over and
  // notices a new day for the free count.
  useEffect(() => {
    if (!ready) return;
    syncTrialReminder();
    const unsubscribe = onProChange(setIsPro);
    let wasBackground = false;
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'background') wasBackground = true;
      if (s !== 'active' || !wasBackground) return;
      wasBackground = false;
      setToday(dayKey(Date.now()));
      checkPro().then((v) => {
        if (v !== null) setIsPro(v);
      });
      syncTrialReminder();
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [ready]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    try {
      for (const [k, v] of Object.entries(patch)) await kvSet(SETTING_PREFIX + k, JSON.stringify(v));
    } catch {
      // non-fatal: the value still applies for this launch
    }
  }, []);

  const spendRecognitions = useCallback(async (n: number) => {
    const day = dayKey(Date.now());
    const next = consume(quotaRef.current, day, n);
    quotaRef.current = next;
    setQuota(next);
    setToday(day);
    await kvSet(QUOTA_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const setActFree = useCallback(async (v: boolean) => {
    if (!TEST_BUILD) return;
    setActFreeState(v);
    await kvSet(ACT_FREE_KEY, v ? '1' : '0').catch(() => {});
  }, []);

  const resetQuota = useCallback(async () => {
    if (!TEST_BUILD) return;
    const fresh: QuotaRecord = { day: '', used: 0 };
    quotaRef.current = fresh;
    setQuota(fresh);
    setToday(dayKey(Date.now()));
    await kvSet(QUOTA_KEY, JSON.stringify(fresh)).catch(() => {});
  }, []);

  const isPro = storePro && !(TEST_BUILD && actFree);
  const remaining = remainingToday(quota, today, isPro);

  const value = useMemo<AppState>(
    () => ({
      settings,
      updateSettings,
      isPro,
      setIsPro,
      testBuild: TEST_BUILD,
      actFree: TEST_BUILD && actFree,
      setActFree,
      resetQuota,
      paywall,
      showPaywall: (reason) => setPaywall(reason),
      hidePaywall: () => setPaywall(null),
      remaining,
      spendRecognitions,
      ready,
      dataVersion,
      bumpData: () => setDataVersion((v) => v + 1),
      notice,
      say,
    }),
    [settings, updateSettings, isPro, actFree, setActFree, resetQuota, paywall, remaining, spendRecognitions, ready, dataVersion, notice, say]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
