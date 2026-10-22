import React, { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useTheme, FONT_FILES } from './src/theme';
import { AppProvider, useApp, ONBOARDED_KEY } from './src/state';
import { countDocs, countPages, kvGet, kvSet } from './src/db';
import { gateNewPage, pagesAllowed } from './src/quota';
import { pickFiles, pickPhotos, Source } from './src/ocr';
import HomeScreen from './src/screens/Home';
import ResultScreen from './src/screens/Result';
import SettingsScreen from './src/screens/Settings';
import CaptureFlow, { CaptureStart } from './src/screens/Capture';
import PaywallModal from './src/screens/Paywall';
import Welcome, { TrialSteps } from './src/screens/Welcome';
import { maybeRequestReviewOnLaunch } from './src/reviews';
import { Slip } from './src/ui/Paper';
import { PRIVACY_URL } from './src/links';

type Route = { name: 'home' } | { name: 'result'; docId: number } | { name: 'settings' };

/** Where new pages come from. */
export type SourceKind = 'scan' | 'photos' | 'files';

function Shell() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, isPro, remaining, showPaywall, paywall, notice, say, spendRecognitions, bumpData } = useApp();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // New installs: three value screens, the trial and reminder screens, then the paywall.
  const [step, setStep] = useState<'welcome' | 'trial' | 'paywall'>('welcome');
  const paywallOpened = useRef(false);
  const [capture, setCapture] = useState<{ start: CaptureStart; docId: number | null; allowed: number } | null>(null);

  useEffect(() => {
    if (!ready || onboarded !== null) return;
    (async () => {
      if ((await kvGet(ONBOARDED_KEY)) === '1') return setOnboarded(true);
      // Anyone who already has scans, or is Pro, has used the app: no onboarding.
      if (isPro || (await countDocs()) > 0) {
        kvSet(ONBOARDED_KEY, '1').catch(() => {});
        return setOnboarded(true);
      }
      setOnboarded(false);
    })().catch(() => setOnboarded(true)); // fail open: never trap anyone
  }, [ready, onboarded, isPro]);

  const openOnboardingPaywall = () => {
    if (paywallOpened.current) return;
    paywallOpened.current = true;
    setStep('paywall');
    showPaywall('pro');
  };

  // When the onboarding paywall closes (purchase or the close button), onboarding is done.
  useEffect(() => {
    if (paywallOpened.current && paywall == null && onboarded === false) {
      setOnboarded(true);
      kvSet(ONBOARDED_KEY, '1').catch(() => {});
    }
  }, [paywall, onboarded]);

  /**
   * How many pages can come in now, or null after opening the paywall:
   * 'batch' on page 3 of a free document, 'limit' when today's free
   * recognitions are gone. 0 means no limit (Pro).
   */
  const allowance = async (docId: number | null): Promise<number | null> => {
    const pages = docId ? await countPages(docId) : 0;
    const gate = gateNewPage({ isPro, pages, remaining });
    if (gate !== 'ok') {
      showPaywall(gate);
      return null;
    }
    const n = pagesAllowed({ isPro, pages, remaining });
    return Number.isFinite(n) ? n : 0;
  };

  const startFrom = async (kind: SourceKind, docId: number | null) => {
    const allowed = await allowance(docId);
    if (allowed == null) return;
    if (kind === 'scan') return setCapture({ start: { kind: 'camera' }, docId, allowed });
    try {
      let sources: Source[] = [];
      if (kind === 'photos') sources = await pickPhotos(allowed);
      else {
        const picked = await pickFiles(allowed);
        sources = picked.sources;
        if (picked.skipped > 0 && !isPro) say(`Reading the first ${sources.length}. Pro reads every page.`);
      }
      if (sources.length > 0) setCapture({ start: { kind: 'sources', sources }, docId, allowed });
    } catch (e: any) {
      Alert.alert('That file did not open', /password/i.test(e?.message ?? '') ? 'This PDF has a password. Open it somewhere else first, or use a screenshot.' : 'Try another one, or a photo of it.');
    }
  };

  const onCaptured = async (res: { docId: number; read: number; empty: number }) => {
    setCapture(null);
    if (res.read > 0) await spendRecognitions(res.read);
    bumpData();
    if (res.read === 0) say('Nothing to read on that one. More light, or a little closer, usually does it.');
    setRoute({ name: 'result', docId: res.docId });
  };

  if (!ready || onboarded === null) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  if (!onboarded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        {step === 'welcome' && <Welcome onDone={() => setStep('trial')} />}
        {step === 'trial' && <TrialSteps onDone={openOnboardingPaywall} />}
        <PaywallModal privacyUrl={PRIVACY_URL} onboarding />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <LaunchReview />
      {route.name === 'home' && (
        <HomeScreen
          onStart={(kind) => startFrom(kind, null)}
          onOpen={(docId) => setRoute({ name: 'result', docId })}
          onSettings={() => setRoute({ name: 'settings' })}
        />
      )}
      {route.name === 'result' && (
        <ResultScreen docId={route.docId} onBack={() => setRoute({ name: 'home' })} onAddPage={(kind) => startFrom(kind, route.docId)} />
      )}
      {route.name === 'settings' && <SettingsScreen onBack={() => setRoute({ name: 'home' })} />}
      <Slip theme={theme} text={notice} bottom={route.name === 'result' ? 84 + insets.bottom : insets.bottom} />
      <CaptureFlow
        visible={capture != null}
        start={capture?.start ?? { kind: 'camera' }}
        docId={capture?.docId ?? null}
        allowed={capture?.allowed ?? 0}
        onDone={onCaptured}
        onCancel={() => setCapture(null)}
      />
      <PaywallModal privacyUrl={PRIVACY_URL} />
    </View>
  );
}

/** Once per launch, from the main screen: the "later calendar day" rating trigger. */
function LaunchReview() {
  useEffect(() => {
    maybeRequestReviewOnLaunch();
  }, []);
  return null;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="auto" />
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
