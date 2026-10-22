import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
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

/** Names for the languages Vision reads, so the list is words, not codes. */
const LANGUAGE_NAMES: Record<string, string> = {
  'en-US': 'English',
  'fr-FR': 'French',
  'it-IT': 'Italian',
  'de-DE': 'German',
  'es-ES': 'Spanish',
  'pt-BR': 'Portuguese',
  'nl-NL': 'Dutch',
  'sv-SE': 'Swedish',
  'da-DK': 'Danish',
  'no-NO': 'Norwegian',
  'nb-NO': 'Norwegian Bokmål',
  'nn-NO': 'Norwegian Nynorsk',
  'pl-PL': 'Polish',
  'cs-CZ': 'Czech',
  'ro-RO': 'Romanian',
  'tr-TR': 'Turkish',
  'id-ID': 'Indonesian',
  'ms-MY': 'Malay',
  'vi-VT': 'Vietnamese',
  'th-TH': 'Thai',
  'ru-RU': 'Russian',
  'uk-UA': 'Ukrainian',
  'ar-SA': 'Arabic',
  'ars-SA': 'Arabic, Najdi',
  'zh-Hans': 'Chinese, Simplified',
  'zh-Hant': 'Chinese, Traditional',
  'yue-Hans': 'Cantonese, Simplified',
  'yue-Hant': 'Cantonese, Traditional',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
};

const FALLBACK_LANGUAGES = ['en-US', 'fr-FR', 'it-IT', 'de-DE', 'es-ES', 'pt-BR'];

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, isPro, setIsPro, showPaywall, bumpData } = useApp();
  const [busy, setBusy] = useState(false);
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
      Alert.alert('The App Store is not answering', 'Try again in a minute.');
      return;
    }
    setBusy(true);
    const res = await restorePurchases();
    setBusy(false);
    if (res.ok) {
      cancelTrialReminder();
      setIsPro(res.isPro);
      Alert.alert(res.isPro ? 'Pro is back on' : 'Nothing to restore', res.isPro ? 'Everything is open again.' : 'This Apple ID has no Image to Text Pro purchase.');
    } else {
      Alert.alert('Restore did not work', res.error ?? 'Try once more.');
    }
  };

  const onDeleteAll = () =>
    Alert.alert('Delete every scan?', 'All the text and photos come off this iPhone and cannot be brought back.', [
      { text: 'Keep them', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        onPress: async () => {
          removeFiles(await deleteAllDocs());
          bumpData();
        },
      },
    ]);

  // English first, then the rest by name.
  const list = [...new Set(['en-US', ...available])].sort((a, b) =>
    a === 'en-US' ? -1 : b === 'en-US' ? 1 : (LANGUAGE_NAMES[a] ?? a).localeCompare(LANGUAGE_NAMES[b] ?? b)
  );

  return (
    <View style={{ flex: 1 }}>
      <TopBar theme={theme} title="Settings" back={{ label: 'Scans', onPress: onBack }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        {isPro ? (
          <Group theme={theme} first title="Pro is on" note="Unlimited scans, Clean up, export files and documents of any length." />
        ) : (
          <Tap onPress={() => showPaywall('pro')} accessibilityRole="button" style={[styles.band, { backgroundColor: theme.paper, borderColor: theme.rule }]} pressedStyle={{ backgroundColor: theme.sunk }}>
            <Text style={[styles.bandText, { color: theme.ink }]}>
              <Text style={{ fontFamily: fonts.heading }}>Image to Text Pro </Text>
              scans without a daily limit, cleans up line breaks, and exports .txt, .pdf and .md.
            </Text>
            <Glyph name="chevron" size={20} color={theme.ink} />
          </Tap>
        )}

        <Group theme={theme} title="Reading languages" note="English is always on. Tick the others you scan in; the phone also spots the language on its own.">
          {list.map((code) => (
            <CheckRow
              key={code}
              theme={theme}
              label={LANGUAGE_NAMES[code] ?? code}
              sub={code === 'en-US' ? 'Always on' : undefined}
              on={code === 'en-US' || settings.languages.includes(code)}
              onPress={() => toggleLanguage(code)}
            />
          ))}
        </Group>

        <Group theme={theme} title="Photos">
          <SwitchRow
            theme={theme}
            label="Keep the original photos"
            sub="Needed to see where a word came from. Off keeps only small thumbnails."
            value={settings.keepOriginals}
            onChange={(v) => updateSettings({ keepOriginals: v })}
          />
        </Group>

        <Group theme={theme} title="Your scans" note="Text is read on this iPhone and stays on it. No account, nothing uploaded, works offline." />

        <Group theme={theme} title="Purchases and help">
          <Row theme={theme} label={busy ? 'Restoring' : 'Restore purchases'} onPress={busy ? undefined : onRestore} />
          <Row theme={theme} label="Terms of Use (EULA)" onPress={() => Linking.openURL(TERMS_URL)} />
          <Row theme={theme} label="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
          <Row theme={theme} label="Help" onPress={() => Linking.openURL(SUPPORT_URL)} />
          <Row theme={theme} label="Email support" value={SUPPORT_EMAIL} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Image%20to%20Text`)} />
        </Group>

        <Group theme={theme} title="Start over">
          <Row theme={theme} label="Delete every scan" danger onPress={onDeleteAll} />
        </Group>

        <Text style={[styles.version, { color: theme.inkFaint }]}>Image to Text {Constants.expoConfig?.version ?? ''}. Made in NYC.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { marginTop: 10, marginHorizontal: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18 },
  bandText: { flex: 1, fontSize: 16, lineHeight: 22 },
  version: { textAlign: 'center', marginTop: 32, fontSize: 13 },
});
