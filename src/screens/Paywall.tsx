import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { useTheme, fonts, radius, tabular, Theme } from '../theme';
import { useApp, PaywallReason } from '../state';
import { getOffering, purchasePackage, restorePurchases, isBillingAvailable } from '../purchases';
import { getTrialEligibleIds, trialLabel } from '../trial';
import { cancelTrialReminder, scheduleTrialReminderIfTrial } from '../reminder';
import { planOrder, preselect, PlanType } from '../offer';
import { FREE_DAILY_RECOGNITIONS, FREE_MAX_PAGES } from '../quota';
import { TERMS_URL } from '../links';
import { CleanUpPair } from '../ui/Drawings';
import Glyph from '../ui/Glyph';
import { GlyphButton, LiveButton, Tap } from '../ui/Tap';

/** On the first-launch paywall the close button appears after this delay. */
const ONBOARDING_CLOSE_DELAY_MS = 3000;

/** The headline and one line, by why the paywall opened. */
const REASON: Record<PaywallReason, { title: string; line: string }> = {
  limit: {
    title: `That was today’s ${FREE_DAILY_RECOGNITIONS} free scans.`,
    line: 'Pro reads as many pages as you like, any day.',
  },
  export: {
    title: 'Export to .txt, .pdf and .md.',
    line: 'Clean files named after the first line, ready to send or keep.',
  },
  cleanup: {
    title: 'One switch for the line breaks.',
    line: 'Clean up joins broken lines into paragraphs and fixes double spaces.',
  },
  batch: {
    title: 'Every page in one document.',
    line: `Free documents hold ${FREE_MAX_PAGES} pages. Pro holds the whole stack and exports it as one file.`,
  },
  pro: {
    title: 'Image to Text Pro.',
    line: 'Scan as much as you like, clean it up, and export it.',
  },
};

const typeOf = (p: PurchasesPackage): PlanType | null =>
  p.packageType === 'WEEKLY' ? 'WEEKLY' : p.packageType === 'ANNUAL' ? 'ANNUAL' : null;

/**
 * Two paywalls in one component (same pattern as Pumping and Odo 1.0.6).
 * Products: itt_pro_weekly ($rc_weekly, 3-day free trial) and
 * itt_pro_yearly ($rc_annual, no trial). No lifetime.
 *  - onboarding: after the trial and reminder screens. Weekly is listed
 *    first and preselected, trial wording shows only when this Apple ID can
 *    get the trial, and the close button appears after 3 seconds.
 *  - in-app (daily limit, export, Clean up, page 3 of a batch, Settings):
 *    Yearly is listed first and preselected as "Yearly, best value", and no
 *    trial is advertised.
 * Prices and trial lengths always come from StoreKit.
 */
export default function PaywallModal({ privacyUrl, onboarding = false }: { privacyUrl: string; onboarding?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Both plans, Continue and the legal footer must fit without scrolling on
  // a 375x667 phone; below 760 pt the hero shrinks.
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const { paywall, hidePaywall, setIsPro } = useApp();
  const visible = paywall != null;
  const reason: PaywallReason = onboarding ? 'pro' : paywall ?? 'pro';
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  // Product ids whose free trial this Apple ID can still get (RevenueCat eligibility check).
  const [trialEligible, setTrialEligible] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [canClose, setCanClose] = useState(!onboarding);

  useEffect(() => {
    if (!visible || !onboarding) return;
    setCanClose(false);
    const t = setTimeout(() => setCanClose(true), ONBOARDING_CLOSE_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, onboarding]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    (async () => {
      const off = await getOffering();
      setOffering(off);
      setTrialEligible(await getTrialEligibleIds(off?.availablePackages ?? []));
      const pkgs = (off?.availablePackages ?? []).filter((p) => typeOf(p) != null);
      const pick = preselect(pkgs.map((p) => typeOf(p) as string), onboarding);
      setSelected(pkgs.find((p) => typeOf(p) === pick) ?? off?.availablePackages?.[0] ?? null);
      setLoading(false);
    })();
  }, [visible, onboarding]);

  const buy = async () => {
    if (!selected) return;
    setPurchasing(true);
    const res = await purchasePackage(selected);
    setPurchasing(false);
    if (res.ok && res.isPro) {
      setIsPro(true);
      hidePaywall();
      // Only does anything when this purchase started a free trial and notifications are allowed.
      const reminded = await scheduleTrialReminderIfTrial();
      Alert.alert('Pro is on', `Scan as much as you like.${reminded ? ' We will remind you the day before the trial ends.' : ''}`);
    } else if (res.ok) {
      // The store took the purchase but Pro isn't showing yet (it can lag).
      Alert.alert('Paid, but Pro is not showing', 'The App Store can lag a minute. Tap Restore purchases in a moment and it turns on.');
    } else if (!res.userCancelled && res.error) {
      Alert.alert('The purchase did not go through', res.error);
    }
  };

  const onRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    const res = await restorePurchases();
    setRestoring(false);
    if (res.ok) cancelTrialReminder();
    if (res.ok && res.isPro) {
      setIsPro(true);
      hidePaywall();
      Alert.alert('Pro is back on', 'Everything is open again.');
    } else if (res.ok) {
      Alert.alert('Nothing to restore', 'This Apple ID has no Image to Text Pro purchase.');
    } else {
      Alert.alert('Restore did not work', res.error ?? 'Try once more.');
    }
  };

  const order = planOrder(onboarding);
  const packages = [...(offering?.availablePackages ?? [])]
    .filter((p) => typeOf(p) != null)
    .sort((a, b) => order.indexOf(typeOf(a) as PlanType) - order.indexOf(typeOf(b) as PlanType));
  const weeklyPkg = packages.find((p) => typeOf(p) === 'WEEKLY');
  const yearlyPkg = packages.find((p) => typeOf(p) === 'ANNUAL');
  const weeklyTrial = trialLabel(weeklyPkg, trialEligible);
  // Trial wording in the headline, plan rows and button area: onboarding only.
  const shownTrial = onboarding ? weeklyTrial : null;

  const money = (n: number, cur?: string) => n.toLocaleString(undefined, { style: 'currency', currency: cur ?? 'USD' });
  const yearlyPerWeek = yearlyPkg?.product.price ? `${money(yearlyPkg.product.price / 52, yearlyPkg.product.currencyCode)} a week` : null;

  // Always-visible 3.1.2(c) disclosure, built from whatever StoreKit returned.
  const parts: string[] = [];
  if (yearlyPkg) parts.push(`Yearly ${yearlyPkg.product.priceString}/year is an auto-renewing subscription billed once a year until cancelled.`);
  if (weeklyPkg)
    parts.push(
      `Weekly ${weeklyPkg.product.priceString}/week is an auto-renewing subscription billed once a week until cancelled${
        weeklyTrial ? `; it starts with ${weeklyTrial} and you are not charged until the trial ends` : ''
      }.`
    );
  const disclosure =
    (parts.length > 0 ? parts.join(' ') : 'Pro is offered as a weekly or a yearly auto-renewing subscription.') +
    ' Payment is charged to your Apple ID. Cancel anytime in your Apple ID settings at least 24 hours before the period ends.';

  const copy = REASON[reason];
  const headline = shownTrial ? `${copy.title} ${shownTrial[0].toUpperCase()}${shownTrial.slice(1)} first.` : copy.title;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => canClose && hidePaywall()}>
      <View style={[styles.container, { backgroundColor: theme.bg }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Holds its space while hidden so nothing jumps when the close button appears. */}
          <View style={[styles.closeRow, { opacity: canClose ? 1 : 0 }]} accessibilityElementsHidden={!canClose} importantForAccessibility={canClose ? 'auto' : 'no-hide-descendants'}>
            <GlyphButton theme={theme} glyph="close" label="Close" onPress={hidePaywall} disabled={!canClose} />
          </View>

          <CleanUpPair theme={theme} compact={compact} />

          <Text style={[styles.title, compact && styles.titleCompact, { color: theme.ink }]} accessibilityRole="header">
            {headline}
          </Text>
          <Text style={[styles.line, { color: theme.inkSoft }]}>{copy.line}</Text>
          <Text style={[styles.what, { color: theme.inkSoft }]}>
            Pro: unlimited scans, Clean up, .txt, .pdf and .md files, and documents of any length.
          </Text>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={theme.ink} />
          ) : packages.length === 0 || !isBillingAvailable() ? (
            <Text style={[styles.unavailable, { color: theme.inkSoft }]}>The App Store is not answering right now. Try again in a bit.</Text>
          ) : (
            <View style={[styles.plans, compact && { marginTop: 14 }, { borderTopColor: theme.rule }]} accessibilityRole="radiogroup">
              {packages.map((p) => {
                const on = selected?.identifier === p.identifier;
                const yearly = typeOf(p) === 'ANNUAL';
                const title = yearly ? (onboarding ? 'Yearly' : 'Yearly, best value') : 'Weekly';
                // 3.1.2(c) on the row itself: trial length, then the price after it.
                const line = yearly
                  ? `${p.product.priceString} a year${yearlyPerWeek ? `, ${yearlyPerWeek}` : ''}`
                  : shownTrial
                    ? `${shownTrial}, then ${p.product.priceString} a week`
                    : `${p.product.priceString} a week`;
                return (
                  <Tap
                    key={p.identifier}
                    onPress={() => setSelected(p)}
                    style={[styles.plan, compact && styles.planCompact, { borderBottomColor: theme.rule, backgroundColor: on ? theme.paper : 'transparent' }]}
                    pressedStyle={{ backgroundColor: theme.sunk }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${title}, ${line}`}
                  >
                    <Radio theme={theme} on={on} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planTitle, { color: theme.ink }]}>{title}</Text>
                      <Text style={[styles.planLine, { color: theme.inkSoft }, tabular]}>{line}</Text>
                    </View>
                    <Text style={[styles.planPrice, { color: theme.ink }, tabular]}>{p.product.priceString}</Text>
                  </Tap>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottom, { borderTopColor: theme.rule, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* The button says Continue, never Subscribe. */}
          <LiveButton theme={theme} tall label={purchasing ? 'One moment' : 'Continue'} onPress={buy} disabled={purchasing || !selected || loading} />
          {selected && onboarding && trialLabel(selected, trialEligible) ? (
            <View style={styles.checkLine}>
              <Glyph name="check" size={18} color={theme.ink} weight={2.2} />
              <Text style={[styles.checkText, { color: theme.ink }]}>No payment now</Text>
            </View>
          ) : null}
          {/*
            App Review guideline 3.1.2(c): title, length, price and functional
            Terms of Use (EULA) + Privacy Policy links live in the app itself.
            Outside the ScrollView and outside the "offering loaded" branch on
            purpose: visible without scrolling, rendered even with no products.
          */}
          <Text style={[styles.legalText, { color: theme.inkFaint }]}>Image to Text Pro. {disclosure}</Text>
          <View style={styles.legalLinks}>
            <Text style={[styles.legalLink, { color: theme.inkSoft }]} onPress={onRestore} accessibilityRole="button">
              {restoring ? 'Restoring' : 'Restore purchases'}
            </Text>
            <Text style={[styles.legalLink, { color: theme.inkSoft }]} onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
              Terms of Use (EULA)
            </Text>
            <Text style={[styles.legalLink, { color: theme.inkSoft }]} onPress={() => Linking.openURL(privacyUrl)} accessibilityRole="link">
              Privacy Policy
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Radio({ theme, on }: { theme: Theme; on: boolean }) {
  return (
    <View style={[styles.radio, { borderColor: on ? theme.ink : theme.inkFaint }]}>
      {on && <View style={[styles.radioDot, { backgroundColor: theme.ink }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 20 },
  closeRow: { alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, marginTop: 22, paddingHorizontal: 20 },
  titleCompact: { fontSize: 25, lineHeight: 30, marginTop: 14 },
  line: { fontSize: 17, lineHeight: 24, marginTop: 6, paddingHorizontal: 20 },
  what: { fontSize: 14, lineHeight: 20, marginTop: 8, paddingHorizontal: 20 },
  plans: { marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 70, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  planCompact: { minHeight: 60, paddingVertical: 8 },
  planTitle: { fontFamily: fonts.heading, fontSize: 19 },
  planLine: { fontSize: 14, marginTop: 2 },
  planPrice: { fontFamily: fonts.display, fontSize: 20 },
  radio: { width: 24, height: 24, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: radius.pill },
  unavailable: { textAlign: 'center', marginVertical: 24, fontSize: 15, paddingHorizontal: 20 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  checkLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  checkText: { fontSize: 15, fontWeight: '600' },
  legalText: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14 },
  legalLink: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline', paddingVertical: 4 },
});
