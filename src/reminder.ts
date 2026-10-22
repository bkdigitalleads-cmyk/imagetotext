/**
 * The one notification the app ever sends: "your free trial ends
 * tomorrow", promised on the onboarding reminder screen and scheduled only
 * once a free trial has started. Local only; nothing comes from a server.
 */
import * as Notifications from 'expo-notifications';
import Purchases from 'react-native-purchases';
import { ENTITLEMENT_ID, isBillingAvailable } from './purchases';
import { trialReminderAt } from './offer';

const TRIAL_ID = 'imagetotext.trialReminder';

// If the app happens to be open when it fires, still show it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** True when notifications are allowed. Asks only if iOS has not asked yet. Never throws. */
export async function requestReminderPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const res = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return res.granted;
  } catch {
    return false;
  }
}

interface TrialState {
  active: boolean;
  willRenew: boolean;
  expiresMs: number | null;
}

/** The pro entitlement's trial state, or null when RevenueCat can't answer (offline, not configured). */
async function getTrialState(): Promise<TrialState | null> {
  if (!isBillingAvailable()) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    const ent = info.entitlements.active[ENTITLEMENT_ID];
    if (!ent || ent.periodType !== 'TRIAL') return { active: false, willRenew: false, expiresMs: null };
    const expiresMs = ent.expirationDate ? Date.parse(ent.expirationDate) : NaN;
    return { active: true, willRenew: ent.willRenew, expiresMs: Number.isFinite(expiresMs) ? expiresMs : null };
  } catch {
    return null;
  }
}

/**
 * After a successful purchase: if it started a free trial and notifications
 * are allowed, schedule the reminder for 1 day before the trial ends.
 * Returns true when a reminder was scheduled. Never asks for permission.
 */
export async function scheduleTrialReminderIfTrial(): Promise<boolean> {
  const trial = await getTrialState();
  if (!trial?.active || !trial.willRenew) return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return false;
    await cancelTrialReminder();
    await Notifications.scheduleNotificationAsync({
      identifier: TRIAL_ID,
      content: {
        title: 'Your free trial ends tomorrow',
        body: 'Image to Text Pro renews tomorrow. Cancel anytime in Settings, Apple ID, Subscriptions.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: trialReminderAt(trial.expiresMs, Date.now()),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelTrialReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_ID);
  } catch {
    // nothing scheduled, or notifications unavailable
  }
}

/**
 * Foreground check: drop the trial reminder once the trial is over, or has
 * been cancelled (it would no longer renew). An unknown answer leaves it alone.
 */
export async function syncTrialReminder(): Promise<void> {
  const trial = await getTrialState();
  if (trial && (!trial.active || !trial.willRenew)) await cancelTrialReminder();
}
