import React from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Theme, fonts, radius } from '../theme';
import Glyph, { GlyphName } from './Glyph';

/** Anything tappable goes through here, so everything shows it was pressed. */
export function Tap({
  style,
  pressedStyle,
  children,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Pressable {...rest} style={({ pressed }) => [style, pressed && (pressedStyle ?? { opacity: 0.55 })]}>
      {children}
    </Pressable>
  );
}

/**
 * The live action: the one thing to do next on a screen, laid in
 * highlighter. Only one per screen.
 */
export function LiveButton({
  theme,
  label,
  onPress,
  glyph,
  disabled = false,
  hint,
  tall = false,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  glyph?: GlyphName;
  disabled?: boolean;
  hint?: string;
  tall?: boolean;
}) {
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      style={[styles.live, tall && styles.tall, { backgroundColor: theme.highlight, opacity: disabled ? 0.45 : 1 }]}
      pressedStyle={{ transform: [{ scale: 0.985 }], opacity: 0.86 }}
    >
      {glyph && <Glyph name={glyph} size={tall ? 26 : 22} color={theme.onHighlight} weight={2} />}
      <Text style={[styles.liveLabel, tall && styles.liveLabelTall, { color: theme.onHighlight }]} maxFontSizeMultiplier={1.5} numberOfLines={2}>
        {label}
      </Text>
    </Tap>
  );
}

/** A second choice beside the live action: ink outline on the paper. */
export function InkButton({
  theme,
  label,
  onPress,
  glyph,
  disabled = false,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  glyph?: GlyphName;
  disabled?: boolean;
}) {
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.ink, { borderColor: theme.ink, opacity: disabled ? 0.4 : 1 }]}
      pressedStyle={{ backgroundColor: theme.sunk }}
    >
      {glyph && <Glyph name={glyph} size={22} color={theme.ink} />}
      <Text style={[styles.inkLabel, { color: theme.ink }]} maxFontSizeMultiplier={1.5} numberOfLines={1}>
        {label}
      </Text>
    </Tap>
  );
}

/** A glyph over a word, for the result toolbar. `tag` is a small note under it ("Pro"). */
export function ToolButton({
  theme,
  glyph,
  label,
  onPress,
  tag,
  a11y,
}: {
  theme: Theme;
  glyph: GlyphName;
  label: string;
  onPress: () => void;
  tag?: string;
  a11y?: string;
}) {
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? (tag ? `${label}, ${tag}` : label)}
      style={styles.tool}
      pressedStyle={{ backgroundColor: theme.sunk }}
    >
      <Glyph name={glyph} size={26} color={theme.ink} />
      <View style={styles.toolWords}>
        <Text style={[styles.toolLabel, { color: theme.ink }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
          {label}
        </Text>
        {tag ? (
          <Text style={[styles.toolTag, { color: theme.inkFaint }]} maxFontSizeMultiplier={1.2}>
            {tag}
          </Text>
        ) : null}
      </View>
    </Tap>
  );
}

/** A round glyph button (close, settings, torch). At least 44 points. */
export function GlyphButton({
  theme,
  glyph,
  label,
  onPress,
  size = 44,
  color,
  on = false,
  disabled = false,
}: {
  theme: Theme;
  glyph: GlyphName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: on }}
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? theme.highlight : 'transparent',
        opacity: disabled ? 0.35 : 1,
      }}
      pressedStyle={{ backgroundColor: on ? theme.highlight : theme.sunk, opacity: 0.8 }}
    >
      <Glyph name={glyph} size={size * 0.56} color={on ? theme.onHighlight : color ?? theme.ink} />
    </Tap>
  );
}

/** A word you can tap, ink with an underline. At least 44 points tall. */
export function WordButton({
  theme,
  label,
  onPress,
  color,
  strong = false,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  color?: string;
  strong?: boolean;
}) {
  return (
    <Tap onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={styles.word}>
      <Text style={[styles.wordLabel, { color: color ?? theme.ink, fontWeight: strong ? fonts.weight.bold : fonts.weight.semibold }]}>{label}</Text>
    </Tap>
  );
}

/** The strip at the top of a screen: a way back on the left, a title, actions on the right. */
export function TopBar({
  theme,
  title,
  back,
  right,
}: {
  theme: Theme;
  title?: string;
  back?: { label: string; onPress: () => void };
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.bar}>
      <View style={styles.barSide}>
        {back && (
          <Tap onPress={back.onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={back.label} style={styles.back}>
            <Glyph name="back" size={24} color={theme.ink} />
            <Text style={[styles.backLabel, { color: theme.ink }]} maxFontSizeMultiplier={1.3}>
              {back.label}
            </Text>
          </Tap>
        )}
      </View>
      {title ? (
        <Text style={[styles.barTitle, { color: theme.ink }]} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={[styles.barSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  live: {
    minHeight: 56,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  tall: { minHeight: 64 },
  liveLabel: { fontSize: 17, fontWeight: fonts.weight.bold },
  liveLabelTall: { fontSize: 19 },
  ink: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inkLabel: { fontSize: 17, fontWeight: fonts.weight.semibold },
  tool: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 60, borderRadius: radius.sheet, paddingVertical: 6 },
  toolWords: { alignItems: 'center' },
  toolLabel: { fontSize: 13, fontWeight: fonts.weight.semibold },
  toolTag: { fontSize: 10, fontWeight: fonts.weight.semibold, letterSpacing: 0.4, marginTop: -1 },
  word: { minHeight: 44, justifyContent: 'center' },
  wordLabel: { fontSize: 17, textDecorationLine: 'underline' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 52 },
  barSide: { flex: 1, minHeight: 44, justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingRight: 8 },
  backLabel: { fontSize: 17 },
  barTitle: { fontFamily: fonts.heading, fontSize: 19, textAlign: 'center', flex: 2 },
});
