/**
 * RevenueCat wrapper with a safe fallback: if no API key is configured
 * (development, or store review edge cases), the app still runs with
 * Pro features locked and purchases unavailable rather than crashing.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  LOG_LEVEL,
} from 'react-native-purchases';

export const ENTITLEMENT_ID = 'pro';

let configured = false;

export function isBillingAvailable(): boolean {
  return configured;
}

export async function initPurchases(): Promise<void> {
  const apiKey: string | undefined =
    Constants.expoConfig?.extra?.revenueCatApiKeyIos;
  // Until the real RevenueCat public key replaces the TODO placeholder in
  // app.json, run as if purchases were unavailable instead of configuring junk.
  if (!apiKey || !apiKey.startsWith('appl_') || Platform.OS !== 'ios') return;
  try {
    Purchases.setLogLevel(LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey });
    configured = true;
  } catch {
    configured = false;
  }
}

export function isProFromCustomerInfo(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

export async function getIsPro(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return isProFromCustomerInfo(info);
  } catch {
    return false;
  }
}

/**
 * Same check as getIsPro, but null when RevenueCat can't answer (offline,
 * not configured), so a foreground re-check never takes Pro away on an error.
 */
export async function checkPro(): Promise<boolean | null> {
  if (!configured) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return isProFromCustomerInfo(info);
  } catch {
    return null;
  }
}

/**
 * Calls back with the Pro state whenever RevenueCat has new customer info
 * (renewal, expiry, refund, purchase on another device). Returns an unsubscribe.
 */
export function onProChange(cb: (isPro: boolean) => void): () => void {
  if (!configured) return () => {};
  const listener = (info: CustomerInfo) => cb(isProFromCustomerInfo(info));
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch {
    return null;
  }
}

export interface PurchaseResult {
  ok: boolean;
  isPro: boolean;
  userCancelled: boolean;
  error?: string;
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!configured) {
    return { ok: false, isPro: false, userCancelled: false, error: 'Purchases unavailable' };
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPro: isProFromCustomerInfo(customerInfo), userCancelled: false };
  } catch (e: any) {
    if (e?.userCancelled) {
      return { ok: false, isPro: false, userCancelled: true };
    }
    return {
      ok: false,
      isPro: false,
      userCancelled: false,
      error: e?.message ?? 'Purchase failed',
    };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!configured) {
    return { ok: false, isPro: false, userCancelled: false, error: 'Purchases unavailable' };
  }
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, isPro: isProFromCustomerInfo(info), userCancelled: false };
  } catch (e: any) {
    return {
      ok: false,
      isPro: false,
      userCancelled: false,
      error: e?.message ?? 'Restore failed',
    };
  }
}
