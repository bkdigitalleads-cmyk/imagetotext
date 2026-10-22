import * as StoreReview from 'expo-store-review';
import { kvGet, kvSet } from './db';
import { dayKey } from './quota';

/**
 * App Store rating asks, at moments of value. Each trigger fires at most
 * once ever, at most one prompt per launch, and StoreKit still decides
 * whether the prompt is actually shown (it caps it at 3 a year).
 *   firstCopy - right after the first successful Copy all
 *   laterDay  - the first launch on a later calendar day than install
 * Same engine as Pumping and Odo 1.0.6, without the launch-offer check
 * (there is no lifetime product here).
 */
export type ReviewTrigger = 'firstCopy' | 'laterDay';

const triggerKey = (t: ReviewTrigger) => `review.${t}`;
const INSTALL_DAY_KEY = 'review.installDay';

let launchState: 'idle' | 'checking' | 'asked' = 'idle';
let launchChecked = false;

export async function maybeRequestReview(trigger: ReviewTrigger): Promise<void> {
  if (launchState !== 'idle') return;
  launchState = 'checking';
  try {
    if (await kvGet(triggerKey(trigger))) return;
    if (!(await StoreReview.hasAction())) return;
    await kvSet(triggerKey(trigger), '1');
    launchState = 'asked';
    setTimeout(() => {
      StoreReview.requestReview().catch(() => {});
    }, 1200);
  } catch {
    // never let review plumbing get in the way
  } finally {
    if (launchState === 'checking') launchState = 'idle';
  }
}

/** Once per cold launch, from Home: records the install day, and asks on the first later day. */
export async function maybeRequestReviewOnLaunch(): Promise<void> {
  if (launchChecked) return;
  launchChecked = true;
  try {
    const today = dayKey(Date.now());
    const installDay = await kvGet(INSTALL_DAY_KEY);
    if (!installDay) {
      await kvSet(INSTALL_DAY_KEY, today);
      return;
    }
    if (installDay !== today) await maybeRequestReview('laterDay');
  } catch {
    // never let review plumbing get in the way
  }
}
