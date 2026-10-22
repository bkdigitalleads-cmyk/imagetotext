import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, radius } from '../theme';
import { dayKey } from '../quota';
import { GlyphButton, InkButton } from '../ui/Tap';

/**
 * Free users' look at the PDF export: their own text laid out as the
 * printed page, with a large SAMPLE watermark. Nothing here can leave the
 * phone; Share and Print close the preview and open the paywall. Same
 * approach as Pumping and Odo 1.0.6.
 */

// The printed page's colors, like the PDF itself. At night the whole page
// is dimmed so it is never brighter than the text around it.
const PAGE = { bg: '#FFFDF8', ink: '#1D1B17', faint: '#8A8375', rule: '#DCD4C3' };

export default function PdfPreview({
  visible,
  pages,
  onClose,
  onLocked,
}: {
  visible: boolean;
  /** Each page's text, as it would be exported. */
  pages: string[];
  onClose: () => void;
  /** Share or Print tapped: the parent closes this and opens the paywall. */
  onLocked: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const kept = pages.map((p) => p.trim()).filter(Boolean);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.sunk }]}>
        <View style={[styles.header, { borderBottomColor: theme.rule, backgroundColor: theme.bg }]}>
          <Text style={[styles.headerTitle, { color: theme.ink }]} accessibilityRole="header">
            PDF preview
          </Text>
          <GlyphButton theme={theme} glyph="close" label="Close the preview" onPress={onClose} color={theme.inkSoft} />
        </View>
        <Text style={[styles.note, { color: theme.inkSoft }]}>Your text as the PDF lays it out. Pro saves and shares the clean copy.</Text>

        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.page, theme.isDark && { opacity: 0.72 }]}>
            <Text style={styles.meta}>
              {dayKey(Date.now())} · {kept.length} {kept.length === 1 ? 'page' : 'pages'}
            </Text>
            {kept.map((p, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.hr} />}
                {p.split(/\n{2,}/).map((para, j) => (
                  <Text key={j} style={styles.p}>
                    {para}
                  </Text>
                ))}
              </View>
            ))}
            <View style={styles.watermarkLayer} pointerEvents="none">
              {[0, 1, 2].map((i) => (
                <Text key={i} style={styles.watermark} accessibilityElementsHidden importantForAccessibility="no">
                  SAMPLE
                </Text>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bar, { borderTopColor: theme.rule, backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={{ flex: 1 }}>
            <InkButton theme={theme} label="Share, Pro" glyph="share" onPress={onLocked} />
          </View>
          <View style={{ flex: 1 }}>
            <InkButton theme={theme} label="Print, Pro" glyph="export" onPress={onLocked} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 10, paddingTop: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 20, fontFamily: fonts.heading },
  note: { fontSize: 14, lineHeight: 19, textAlign: 'center', paddingHorizontal: 24, paddingTop: 12 },
  scroll: { padding: 16, paddingBottom: 32 },
  page: {
    backgroundColor: PAGE.bg,
    borderRadius: radius.sheet,
    paddingHorizontal: 26,
    paddingVertical: 30,
    minHeight: 480,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  meta: { fontSize: 9, color: PAGE.faint, letterSpacing: 0.3, marginBottom: 14 },
  p: { fontFamily: 'Georgia', fontSize: 11.5, lineHeight: 18, color: PAGE.ink, marginBottom: 9 },
  hr: { height: 1, backgroundColor: PAGE.rule, marginVertical: 16 },
  watermarkLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'space-around' },
  watermark: { fontFamily: fonts.display, fontSize: 80, letterSpacing: 6, color: 'rgba(29, 27, 23, 0.12)', transform: [{ rotate: '-28deg' }] },
  bar: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
