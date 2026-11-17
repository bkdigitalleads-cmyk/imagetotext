import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, radius, tabular, Theme } from '../theme';
import { useApp } from '../state';
import { deleteDoc, DocSummary, getDocSummaries } from '../db';
import { removeFiles, scanUri } from '../files';
import { FREE_DAILY_RECOGNITIONS } from '../quota';
import Glyph, { GlyphName } from '../ui/Glyph';
import { GhostLeaf, Leaf } from '../ui/Paper';
import { Tap } from '../ui/Tap';
import type { SourceKind } from '../../App';
import { t, whenLabel } from '../i18n';

/**
 * Home: the three ways in, big enough for a thumb, and every scan below
 * them, newest first. Scan is the live action; Photos and Files sit beside
 * it in ink.
 */
export default function HomeScreen({
  onStart,
  onOpen,
  onSettings,
}: {
  onStart: (kind: SourceKind) => void;
  onOpen: (docId: number) => void;
  onSettings: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { dataVersion, isPro, remaining, bumpData } = useApp();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);

  useEffect(() => {
    getDocSummaries()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [dataVersion]);

  const s = t();
  const onLongPress = (d: DocSummary) =>
    Alert.alert(s.deleteScanTitle, d.title || s.deleteScanHomeBody, [
      { text: s.keepIt, style: 'cancel' },
      {
        text: s.delete,
        style: 'destructive',
        onPress: async () => {
          removeFiles(await deleteDoc(d.id));
          bumpData();
        },
      },
    ]);

  const header = (
    <View>
      <View style={styles.top}>
        <Text style={[styles.name, { color: theme.ink }]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          Image to Text
        </Text>
        <Tap
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={s.settings}
          style={styles.settings}
          pressedStyle={{ backgroundColor: theme.sunk }}
        >
          <Glyph name="settings" size={22} color={theme.ink} />
          <Text style={[styles.settingsLabel, { color: theme.ink }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
            {s.settings}
          </Text>
        </Tap>
      </View>

      <Tap
        onPress={() => onStart('scan')}
        accessibilityRole="button"
        accessibilityLabel={s.scan}
        accessibilityHint={s.scanHint}
        style={[styles.scan, { backgroundColor: theme.highlight }]}
        pressedStyle={{ transform: [{ scale: 0.985 }], opacity: 0.88 }}
      >
        <Glyph name="camera" size={40} color={theme.onHighlight} weight={2} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.scanLabel, { color: theme.onHighlight }]} maxFontSizeMultiplier={1.5}>
            {s.scan}
          </Text>
          <Text style={[styles.scanSub, { color: theme.onHighlight }]} maxFontSizeMultiplier={1.4}>
            {s.scanSub}
          </Text>
        </View>
      </Tap>

      <View style={styles.pair}>
        <Side theme={theme} glyph="picture" label={s.photos} hint={s.photosHint} onPress={() => onStart('photos')} />
        <Side theme={theme} glyph="folder" label={s.files} hint={s.filesHint} onPress={() => onStart('files')} />
      </View>

      {!isPro && (
        <Text style={[styles.count, { color: theme.inkSoft }, tabular]} accessibilityLiveRegion="polite">
          {remaining > 0 ? s.freeLeft(remaining, FREE_DAILY_RECOGNITIONS) : s.freeUsed(FREE_DAILY_RECOGNITIONS)}
        </Text>
      )}

      {docs && docs.length > 0 && (
        <Text style={[styles.section, { color: theme.ink, borderBottomColor: theme.rule }]} accessibilityRole="header">
          {s.yourScans}
        </Text>
      )}
    </View>
  );

  return (
    <FlatList
      data={docs ?? []}
      keyExtractor={(d) => String(d.id)}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      ListEmptyComponent={docs ? <Empty theme={theme} /> : null}
      renderItem={({ item }) => <HistoryRow theme={theme} doc={item} onPress={() => onOpen(item.id)} onLongPress={() => onLongPress(item)} />}
    />
  );
}

function Side({ theme, glyph, label, hint, onPress }: { theme: Theme; glyph: GlyphName; label: string; hint: string; onPress: () => void }) {
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={[styles.side, { backgroundColor: theme.paper, borderColor: theme.rule }]}
      pressedStyle={{ backgroundColor: theme.sunk }}
    >
      <Glyph name={glyph} size={34} color={theme.ink} />
      <Text style={[styles.sideLabel, { color: theme.ink }]} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </Tap>
  );
}

/** The empty history: a sheet that is not there yet, and one line. */
function Empty({ theme }: { theme: Theme }) {
  return (
    <View style={styles.empty}>
      <GhostLeaf theme={theme} width={64} />
      <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t().emptyHome}</Text>
    </View>
  );
}

function HistoryRow({ theme, doc, onPress, onLongPress }: { theme: Theme; doc: DocSummary; onPress: () => void; onLongPress: () => void }) {
  const s = t();
  const when = whenLabel(doc.createdAt);
  const pages = s.pages(doc.pageCount);
  const title = doc.title || s.noTextFound;
  return (
    <Tap
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { borderBottomColor: theme.rule }]}
      pressedStyle={{ backgroundColor: theme.sunk }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${when}, ${pages}`}
      accessibilityHint={s.rowHint}
    >
      <Leaf theme={theme} uri={scanUri(doc.thumb)} width={46} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: doc.title ? theme.ink : theme.inkFaint }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.inkFaint }, tabular]}>
          {when} · {pages}
        </Text>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 10, paddingTop: 10 },
  name: { fontFamily: fonts.display, fontSize: 30, lineHeight: 38, flexShrink: 1 },
  settings: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.pill },
  settingsLabel: { fontSize: 17, fontWeight: fonts.weight.medium },
  scan: {
    marginHorizontal: 16,
    marginTop: 14,
    minHeight: 104,
    borderRadius: radius.tray,
    paddingHorizontal: 22,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  scanLabel: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  scanSub: { fontSize: 15, marginTop: 1, opacity: 0.8 },
  pair: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 12 },
  side: {
    flex: 1,
    minHeight: 92,
    borderRadius: radius.tray,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 16,
    gap: 8,
  },
  sideLabel: { fontFamily: fonts.heading, fontSize: 21 },
  count: { fontSize: 14, marginTop: 14, marginHorizontal: 20 },
  section: { fontFamily: fonts.heading, fontSize: 21, paddingHorizontal: 20, paddingTop: 30, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 24, paddingTop: 40 },
  emptyText: { flex: 1, fontSize: 17, lineHeight: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 17, lineHeight: 22, fontWeight: fonts.weight.medium },
  rowMeta: { fontSize: 14, marginTop: 3 },
});
