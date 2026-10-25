import React, { useEffect, useRef } from 'react';
import { Animated, Image, Modal, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { Theme, fonts, radius, tabular } from '../theme';
import { useReduceMotion } from './motion';

/** Photos sit a little dimmer on dim paper, so a white page never glares at night. */
export const DIM_PHOTO = 0.82;

/**
 * A page thumbnail: a sheet of paper with the photo on it, a folded corner
 * and a soft shadow edge. Every scan in the app is shown as one of these.
 */
export function Leaf({
  theme,
  uri,
  width,
  ratio = 1.32,
  fold = 0.2,
  label,
}: {
  theme: Theme;
  uri?: string | null;
  width: number;
  /** height / width */
  ratio?: number;
  /** Size of the folded corner, as a share of the width. */
  fold?: number;
  label?: string;
}) {
  const height = Math.round(width * ratio);
  const f = Math.round(width * fold);
  return (
    <View style={{ width: width + 2, height: height + 2 }} accessible={!!label} accessibilityLabel={label} accessibilityRole={label ? 'image' : undefined}>
      <View style={[StyleSheet.absoluteFill, { left: 2, top: 2, backgroundColor: theme.shade, borderRadius: radius.sheet }]} />
      <View style={{ width, height, backgroundColor: theme.paper, borderRadius: radius.sheet, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.rule }}>
        {uri ? <Image source={{ uri }} style={[StyleSheet.absoluteFill, theme.isDark && { opacity: DIM_PHOTO }]} resizeMode="cover" /> : <RuledLines theme={theme} width={width} height={height} />}
        <Svg width={f + 1} height={f + 1} style={{ position: 'absolute', right: -0.5, top: -0.5 }}>
          <Path d={`M0 0 H${f + 1} V${f + 1} Z`} fill={theme.bg} />
          <Path d={`M0 0 L${f} ${f} H0 Z`} fill={theme.sunk} />
          <Path d={`M0 0 L${f} ${f}`} stroke={theme.rule} strokeWidth={1} />
        </Svg>
      </View>
    </View>
  );
}

/** Faint ruled lines on a blank sheet. */
function RuledLines({ theme, width, height }: { theme: Theme; width: number; height: number }) {
  const gap = Math.max(6, width * 0.11);
  const rows = Math.floor((height - gap * 1.6) / gap);
  return (
    <Svg width={width} height={height}>
      {Array.from({ length: rows }, (_, i) => (
        <Line key={i} x1={width * 0.14} x2={width * (i % 3 === 2 ? 0.62 : 0.86)} y1={gap * 1.6 + i * gap} y2={gap * 1.6 + i * gap} stroke={theme.rule} strokeWidth={Math.max(1, width / 60)} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

/** The empty history: the outline of a sheet that is not there yet. */
export function GhostLeaf({ theme, width, ratio = 1.32 }: { theme: Theme; width: number; ratio?: number }) {
  const height = Math.round(width * ratio);
  const f = Math.round(width * 0.2);
  const w = width;
  const dash = `${Math.max(4, width / 18)} ${Math.max(4, width / 22)}`;
  return (
    <Svg width={w + 2} height={height + 2} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path
        d={`M1 1 H${w - f} L${w + 1} ${f + 1} V${height + 1} H1 Z M${w - f} 1 V${f + 1} H${w + 1}`}
        fill="none"
        stroke={theme.inkFaint}
        strokeWidth={1.4}
        strokeDasharray={dash}
        strokeLinejoin="round"
      />
      {[0.32, 0.45, 0.58].map((y, i) => (
        <Line key={y} x1={w * 0.18} x2={w * (i === 2 ? 0.55 : 0.8)} y1={height * y} y2={height * y} stroke={theme.rule} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" />
      ))}
    </Svg>
  );
}

/** A count in the slab face with figures of equal width, so it never jitters as it changes. */
export function Count({ value, size, color, style }: { value: string; size: number; color: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontFamily: fonts.display, fontSize: size, color }, tabular, style]} maxFontSizeMultiplier={1.4}>
      {value}
    </Text>
  );
}

/** The one-line note at the bottom of the screen ("Copied. 412 words."): a slip of ink-dark paper. */
export function Slip({ theme, text, bottom = 0 }: { theme: Theme; text: string | null; bottom?: number }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={[styles.slipWrap, { bottom: bottom + 12 }]}>
      <View style={[styles.slip, { backgroundColor: theme.ink }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Text style={[styles.slipText, { color: theme.bg }, tabular]}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * A slip of ink-dark paper inside the page, above the text, with an action
 * and a close button: the one place the app admits a photo was hard to read.
 */
export function SlipNote({
  theme,
  text,
  action,
  onClose,
  closeLabel = 'Dismiss',
}: {
  theme: Theme;
  text: string;
  action: { label: string; onPress: () => void };
  onClose: () => void;
  /** The second choice; "Dismiss" unless the note needs a plainer word ("Use anyway"). */
  closeLabel?: string;
}) {
  return (
    <View style={[styles.note, { backgroundColor: theme.ink }]} accessibilityLiveRegion="polite">
      <Text style={[styles.noteText, { color: theme.bg }]}>{text}</Text>
      <View style={styles.noteActions}>
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={8} style={({ pressed }) => [styles.noteAction, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.noteActionText, { color: theme.bg }]}>{action.label}</Text>
        </Pressable>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={8} style={({ pressed }) => [styles.noteAction, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.noteDismiss, { color: theme.bg }]}>{closeLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A tray of paper that slides up from the bottom (export choices, the
 * source of a word, the page order). A transparent modal, so it sits above
 * everything, closed by the backdrop or the close word.
 */
export function Tray({
  theme,
  visible,
  onClose,
  title,
  children,
  style,
}: {
  theme: Theme;
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const y = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduce) {
      y.setValue(0);
      return;
    }
    y.setValue(1);
    Animated.timing(y, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }, [visible, reduce, y]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.trayRoot}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20, 18, 15, 0.38)' }]} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <Animated.View
          style={[
            styles.tray,
            { backgroundColor: theme.paper, paddingBottom: Math.max(insets.bottom, 16) },
            { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }] },
            style,
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: theme.rule }]} />
          {title ? (
            <Text style={[styles.trayTitle, { color: theme.ink }]} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A thin rule, full width or inset. */
export function Rule({ theme, inset = 0 }: { theme: Theme; inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.rule, marginLeft: inset }} />;
}

/** A box drawn around part of an image, for the source of a word. */
export function Mark({ theme, x, y, width, height }: { theme: Theme; x: number; y: number; width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={x} y={y} width={width} height={height} fill={theme.highlightWash} rx={2} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  slipWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  slip: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.sheet, maxWidth: 420 },
  slipText: { fontSize: 16, fontWeight: fonts.weight.semibold, lineHeight: 21 },
  note: { borderRadius: radius.sheet, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, marginBottom: 18 },
  noteText: { fontSize: 16, lineHeight: 22, fontWeight: fonts.weight.semibold },
  noteActions: { flexDirection: 'row', gap: 22 },
  noteAction: { minHeight: 44, justifyContent: 'center' },
  noteActionText: { fontSize: 16, fontWeight: fonts.weight.bold, textDecorationLine: 'underline' },
  noteDismiss: { fontSize: 16, opacity: 0.75 },
  trayRoot: { flex: 1, justifyContent: 'flex-end' },
  tray: { borderTopLeftRadius: radius.tray, borderTopRightRadius: radius.tray, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 8 },
  trayTitle: { fontFamily: fonts.heading, fontSize: 21, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
});
