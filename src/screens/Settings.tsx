import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { useApp } from '../state';
import { deleteAllDocs } from '../db';
import { removeFiles } from '../files';
import { restorePurchases, isBillingAvailable } from '../purchases';
import { cancelTrialReminder } from '../reminder';
import { supportedLanguages } from '../../modules/vision-ocr';
import { PRIVACY_URL, SUPPORT_EMAIL, SUPPORT_URL, TERMS_URL } from '../links';
import { CheckRow, Group, Row, SwitchRow } from '../ui/Rows';
import { Tap, TopBar } from '../ui/Tap';
import Glyph from '../ui/Glyph';
import { lang, locale, t } from '../i18n';

const FALLBACK_LANGUAGES = ['en-US', 'fr-FR', 'it-IT', 'de-DE', 'es-ES', 'pt-BR'];

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, isPro, setIsPro, showPaywall, bumpData, testBuild, actFree, setActFree, resetQuota, say } = useApp();
  const s = t();
  const names = s.languageNames;
  const [busy, setBusy] = useState(false);
  // Test builds only: seven taps on the version line open the Testing tools.
  const [testing, setTesting] = useState(false);
  const taps = useRef<{ count: number; at: number }>({ count: 0, at: 0 });
  const onVersionTap = () => {
    if (!testBuild) return;
    const now = Date.now();
    taps.current = { count: now - taps.current.at < 1500 ? taps.current.count + 1 : 1, at: now };
    if (taps.current.count >= 7) setTesting(true);
  };
  const [available, setAvailable] = useState<string[]>(FALLBACK_LANGUAGES);

  useEffect(() => {
    supportedLanguages()
      .then((l) => setAvailable(l.length > 1 ? l : FALLBACK_LANGUAGES))
      .catch(() => {});
  }, []);

  const toggleLanguage = (code: string) => {
    if (code === 'en-US') return; // always read
    const on = settings.languages.includes(code);
    const next = on ? settings.languages.filter((l) => l !== code) : [...settings.languages, code];
    updateSettings({ languages: next.length > 0 ? next : ['en-US'] });
  };

  const onRestore = async () => {
    if (!isBillingAvailable()) {
      Alert.alert(s.storeNotAnswering, s.tryInAMinute);
      return;
    }
    setBusy(true);
    const res = await restorePurchases();
    setBusy(false);
    if (res.ok) {
      cancelTrialReminder();
      setIsPro(res.isPro);
      Alert.alert(res.isPro ? s.proBackOn : s.nothingToRestore, res.isPro ? s.everythingOpen : s.noPurchase);
    } else {
      // The store's own error text is English; other languages get the plain line.
      Alert.alert(s.restoreFailed, (lang() === 'en' && res.error) || s.tryOnceMore);
    }
  };

  const onDeleteAll = () =>
    Alert.alert(s.deleteEveryTitle, s.deleteEveryBody, [
      { text: s.keepThem, style: 'cancel' },
      {
        text: s.deleteEverything,
        style: 'destructive',
        onPress: async () => {
          removeFiles(await deleteAllDocs());
          bumpData();
        },
      },
    ]);

  // English first, then the rest by name.
  const list = [...new Set(['en-US', ...available])].sort((a, b) =>
    a === 'en-US' ? -1 : b === 'en-US' ? 1 : (names[a] ?? a).localeCompare(names[b] ?? b, locale())
  );

  return (
    <View style={{ flex: 1 }}>
      <TopBar theme={theme} title={s.settings} back={{ label: s.scansBack, onPress: onBack }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        {isPro ? (
          <Group theme={theme} first title={s.proIsOn} note={s.proIsOnNote} />
        ) : (
          <Tap onPress={() => showPaywall('pro')} accessibilityRole="button" style={[styles.band, { backgroundColor: theme.paper, borderColor: theme.rule }]} pressedStyle={{ backgroundColor: theme.sunk }}>
            <Text style={[styles.bandText, { color: theme.ink }]}>
              <Text style={{ fontFamily: fonts.heading }}>Image to Text Pro </Text>
              {s.proBand}
            </Text>
            <Glyph name="chevron" size={20} color={theme.ink} />
          </Tap>
        )}

        <Group theme={theme} title={s.readingLanguages} note={s.readingLanguagesNote}>
          {list.map((code) => (
            <CheckRow
              key={code}
              theme={theme}
              label={names[code] ?? code}
              sub={code === 'en-US' ? s.alwaysOn : undefined}
              on={code === 'en-US' || settings.languages.includes(code)}
              onPress={() => toggleLanguage(code)}
            />
          ))}
        </Group>

        <Group theme={theme} title={s.photosGroup}>
          <SwitchRow
            theme={theme}
            label={s.keepOriginals}
            sub={s.keepOriginalsSub}
            value={settings.keepOriginals}
            onChange={(v) => updateSettings({ keepOriginals: v })}
          />
        </Group>

        <Group theme={theme} title={s.yourScans} note={s.yourScansNote} />

        <Group theme={theme} title={s.purchasesHelp}>
          <Row theme={theme} label={busy ? s.restoring : s.restorePurchases} onPress={busy ? undefined : onRestore} />
          <Row theme={theme} label={s.terms} onPress={() => Linking.openURL(TERMS_URL)} />
          <Row theme={theme} label={s.privacy} onPress={() => Linking.openURL(PRIVACY_URL)} />
          <Row theme={theme} label={s.help} onPress={() => Linking.openURL(SUPPORT_URL)} />
          <Row theme={theme} label={s.emailSupport} value={SUPPORT_EMAIL} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Image%20to%20Text`)} />
        </Group>

        <Group theme={theme} title={s.startOver}>
          <Row theme={theme} label={s.deleteEveryScan} danger onPress={onDeleteAll} />
        </Group>

        {testBuild && (testing || actFree) && (
          <Group theme={theme} title={s.testing} note={s.testingNote}>
            <SwitchRow
              theme={theme}
              label={s.actFree}
              sub={s.actFreeSub}
              value={actFree}
              onChange={(v) => setActFree(v)}
            />
            <Row
              theme={theme}
              label={s.resetFree}
              onPress={async () => {
                await resetQuota();
                say(s.resetFreeDone);
              }}
            />
          </Group>
        )}

        <Text style={[styles.version, { color: theme.inkFaint }]} onPress={onVersionTap} suppressHighlighting>
          {s.versionLine(Constants.expoConfig?.version ?? '')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { marginTop: 10, marginHorizontal: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18 },
  bandText: { flex: 1, fontSize: 16, lineHeight: 22 },
  version: { textAlign: 'center', marginTop: 32, fontSize: 13 },
});
