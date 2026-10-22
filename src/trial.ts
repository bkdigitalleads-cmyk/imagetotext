/**
 * Free-trial wording is shown only when RevenueCat says this Apple ID can
 * still get the trial. Someone who already used it sees the plain price.
 * The rules themselves are pure and unit-checked in offer.ts.
 */
import Purchases, { INTRO_ELIGIBILITY_STATUS, PurchasesPackage } from 'react-native-purchases';
import { isBillingAvailable } from './purchases';
import { trialLabelFrom, trialLength } from './offer';

/** Product ids among `pkgs` whose free trial this user can still get. Unknown counts as no. */
export async function getTrialEligibleIds(pkgs: PurchasesPackage[]): Promise<Set<string>> {
  const ids = pkgs.filter((p) => trialLength(p.product.introPrice) != null).map((p) => p.product.identifier);
  if (!isBillingAvailable() || ids.length === 0) return new Set();
  try {
    const res = await Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
    return new Set(
      ids.filter((id) => res[id]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE)
    );
  } catch {
    return new Set();
  }
}

/** "3 days free", or null when the package has no free trial or the user can't get it. */
export function trialLabel(pkg: PurchasesPackage | undefined | null, eligible: Set<string>): string | null {
  if (!pkg) return null;
  return trialLabelFrom(pkg.product.introPrice, eligible.has(pkg.product.identifier));
}
