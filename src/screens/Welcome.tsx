import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme, fonts, radius, Theme } from '../theme';
import { getOffering } from '../purchases';
import { getTrialEligibleIds, trialLabel } from '../trial';
import { requestReminderPermission } from '../reminder';
import { trialLength } from '../offer';
import { HandToType, OfflinePhone, PhotoToText, TrialDays } from '../ui/Drawings';
import Glyph from '../ui/Glyph';
import { LiveButton } from '../ui/Tap';

/**
 * First launch, in this order (App.tsx runs it):
 *   1-3. three value screens, each one drawing and one short headline
 *   a.   TrialSteps "Try it free"                      } only when RevenueCat says this
 *   b.   TrialSteps "We'll remind you the day before"  } Apple ID can get the free trial
 *   then the onboarding paywall (close button after 3 seconds).
 * No setup questions: this app has one job.
 */
const PAGES = [
  { title: 'A page becomes text in about two seconds.', line: 'Copy it, clean it up, send it on.' },
  { title: 'Handwriting too, not just print.', line: 'Notes, whiteboards, receipts, letters.' },
  { title: 'Nothing leaves your phone.', line: 'It reads on the device. No account, works offline.' },
];

interface TrialOffer {
  /** "3 days" */
  length: string;
  /** "$4.99 a week" */
  then: string;
}

let offerPromise: Promise<TrialOffer | null> | null = null;

/** The trial to offer, or null when not eligible or the store can't answer. */
async function loadTrialOffer(): Promise<TrialOffer | null> {
  const off = await getOffering();
  const pkg = off?.weekly;
  if (!pkg) return null;
  if (!trialLabel(pkg, await getTrialEligibleIds([pkg]))) return null;
  const length = trialLength(pkg.product.introPrice);
  if (!length) return null;
  return { length, then: `${pkg.product.priceString} a week` };
}

/** Starts the eligibility check early; it is ready long before the trial screen. */
function trialOffer(): Promise<TrialOffer | null> {
  if (!offerPromise) offerPromise = loadTrialOffer().catch(() => null);
  return offerPromise;
}

export default function Welcome({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [step, setStep] = useState(0);

  useEffect(() => {
    trialOffer();
  }, []);

  const next = () => (step < PAGES.length - 1 ? setStep(step + 1) : onDone());

  return (
    <Page theme={theme} title={PAGES[step].title} line={PAGES[step].line} dots={{ count: PAGES.length, active: step }} button="Continue" onPress={next}>
      {step === 0 && <PhotoToText theme={theme} />}
      {step === 1 && <HandToType theme={theme} />}
      {step === 2 && <OfflinePhone theme={theme} />}
    </Page>
  );
}

/** The trial and reminder screens. Calls onDone right away when no trial is on offer. */
export function TrialSteps({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [offer, setOffer] = useState<TrialOffer | null | undefined>(undefined);
  const [step, setStep] = useState<'trial' | 'remind'>('trial');
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let live = true;
    trialOffer().then((o) => {
      if (!live) return;
      if (o) setOffer(o);
      else onDone();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!offer) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg, justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  if (step === 'trial') {
    return (
      <Page
        theme={theme}
        title={`Try it free for ${offer.length}.`}
        line={`Then ${offer.then}. Cancel in Settings any time before it ends.`}
        button="Continue"
        onPress={() => setStep('remind')}
        noPayment
      >
        <FreeLabel theme={theme} text={`${offer.length} free`} />
      </Page>
    );
  }

  return (
    <Page
      theme={theme}
      title="We’ll remind you the day before it ends."
      line="One notification, on this phone. Nothing else, ever."
      button="Continue"
      waiting={waiting}
      onPress={async () => {
        // Ask for notifications, then on to the paywall whatever the answer.
        setWaiting(true);
        await requestReminderPermission();
        setWaiting(false);
        onDone();
      }}
    >
      <TrialDays theme={theme} />
    </Page>
  );
}

/** "3 days free" typed on a slip, underlined by hand. */
function FreeLabel({ theme, text }: { theme: Theme; text: string }) {
  return (
    <View style={[styles.label, { backgroundColor: theme.paper, borderColor: theme.rule }]} accessible accessibilityLabel={text}>
      <Text style={[styles.labelText, { color: theme.ink }]}>{text}</Text>
      <Svg width={200} height={14} viewBox="0 0 200 14">
        <Path d="M4 8 C 50 3, 110 12, 196 5" stroke={theme.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** One idea per screen: the drawing, a short headline, the dots and the button. */
function Page({
  theme,
  title,
  line,
  children,
  dots,
  button,
  onPress,
  waiting = false,
  noPayment = false,
}: {
  theme: Theme;
  title: string;
  line?: string;
  children: React.ReactNode;
  dots?: { count: number; active: number };
  button: string;
  onPress: () => void;
  waiting?: boolean;
  noPayment?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.hero}>{children}</View>
      <View style={styles.words}>
        <Text style={[styles.title, { color: theme.ink }]} accessibilityRole="header">
          {title}
        </Text>
        {line ? <Text style={[styles.line, { color: theme.inkSoft }]}>{line}</Text> : null}
      </View>
      {dots && (
        <View style={styles.dots} accessible accessibilityLabel={`Page ${dots.active + 1} of ${dots.count}`}>
          {Array.from({ length: dots.count }, (_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i === dots.active ? theme.ink : theme.rule }, i === dots.active && { width: 22 }]} />
          ))}
        </View>
      )}
      <View style={styles.footer}>
        {waiting ? <ActivityIndicator color={theme.ink} style={{ height: 64 }} /> : <LiveButton theme={theme} tall label={button} onPress={onPress} />}
        {noPayment && (
          <View style={styles.noPaymentRow}>
            <Glyph name="check" size={18} color={theme.ink} weight={2.2} />
            <Text style={[styles.noPayment, { color: theme.ink }]}>No payment now</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  words: { paddingHorizontal: 28, paddingBottom: 18 },
  title: { fontSize: 33, lineHeight: 39, fontFamily: fonts.display },
  line: { fontSize: 17, lineHeight: 24, marginTop: 10 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  footer: { paddingHorizontal: 20, gap: 10 },
  noPaymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  noPayment: { fontSize: 15, textAlign: 'center', fontWeight: fonts.weight.semibold },
  label: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sheet, alignItems: 'center', transform: [{ rotate: '-2deg' }] },
  labelText: { fontFamily: fonts.display, fontSize: 52, lineHeight: 60 },
});
