/**
 * The app's drawings, for onboarding and the paywalls. Ink on paper, with
 * the highlighter only where it marks recognized text that is selected.
 * Handwriting is drawn as pen strokes (not a font), the same every time.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Path, Rect } from 'react-native-svg';
import { Theme, fonts, radius } from '../theme';

// ---------- pen strokes ----------

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A line of joined-up handwriting along a baseline: loops of varying
 * height, the odd tall letter, gaps between words. `words` are letter counts.
 */
export function penLine(x: number, y: number, words: number[], xh: number, seed: number): string {
  const r = seeded(seed);
  const step = xh * 0.62;
  let cx = x;
  const parts: string[] = [];
  for (const letters of words) {
    parts.push(`M${cx.toFixed(1)} ${(y - xh * 0.3).toFixed(1)}`);
    for (let i = 0; i < letters; i++) {
      const tall = r() < 0.18;
      const h = xh * (tall ? 1.9 : 0.85 + r() * 0.3);
      const peakX = cx + step * (0.35 + r() * 0.2);
      const endX = cx + step * (0.9 + r() * 0.25);
      parts.push(`Q${peakX.toFixed(1)} ${(y - h * 1.25).toFixed(1)} ${(peakX + step * 0.12).toFixed(1)} ${(y - h * 0.15).toFixed(1)}`);
      parts.push(`Q${(endX - step * 0.2).toFixed(1)} ${(y + xh * 0.12).toFixed(1)} ${endX.toFixed(1)} ${(y - xh * 0.35).toFixed(1)}`);
      cx = endX;
    }
    cx += step * 1.4;
  }
  return parts.join(' ');
}

/** Printed text seen small: rows of short ink bars with word gaps. */
function printRows(x: number, y: number, width: number, rows: number, gap: number, seed: number, color: string, h = 3) {
  const r = seeded(seed);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < rows; i++) {
    let cx = x;
    const end = x + width * (i === rows - 1 ? 0.55 : 0.92 + r() * 0.08);
    while (cx < end - 6) {
      const w = Math.min(end - cx, 8 + r() * 22);
      out.push(<Rect key={`${i}-${cx.toFixed(0)}`} x={cx} y={y + i * gap} width={w} height={h} rx={h / 2} fill={color} />);
      cx += w + 4;
    }
  }
  return out;
}

// ---------- onboarding 1: a photo becomes text ----------

/** A photo of a page, held in an album corner, and the lines of text it turns into. */
export function PhotoToText({ theme, width = 330 }: { theme: Theme; width?: number }) {
  const s = width / 300;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="A photo of a handwritten page, and the same lines as text, the first one highlighted.">
      <Svg width={300 * s} height={250 * s} viewBox="0 0 300 250">
        {/* the photo */}
        <G transform="rotate(-4 110 95)">
          <Rect x={22} y={18} width={176} height={148} fill={theme.paper} stroke={theme.rule} strokeWidth={1.5} />
          <Rect x={32} y={28} width={156} height={128} fill={theme.sunk} />
          <G transform="rotate(3 110 92)">
            <Rect x={50} y={38} width={120} height={112} fill={theme.paper} />
            {[64, 84, 104, 124].map((y, i) => (
              <Path key={y} d={penLine(60, y, i === 3 ? [3, 4] : [4, 3, 5], 6.5, 11 + i)} stroke={theme.inkSoft} strokeWidth={1.6} fill="none" strokeLinecap="round" />
            ))}
          </G>
          {/* the album corner */}
          <Path d="M14 10 H60 L14 56 Z" fill={theme.ink} />
          <Path d="M206 174 H160 L206 128 Z" fill={theme.ink} />
        </G>
        {/* the text it becomes */}
        <Rect x={112} y={176} width={168} height={20} fill={theme.highlight} rx={2} />
        <Rect x={120} y={183} width={150} height={6} rx={3} fill={theme.onHighlight} />
        {printRows(120, 206, 160, 3, 14, 4, theme.ink, 6)}
      </Svg>
    </View>
  );
}

// ---------- onboarding 2: handwriting ----------

/** A handwritten note, and what it says, typed. */
export function HandToType({ theme, width = 300 }: { theme: Theme; width?: number }) {
  const s = width / 300;
  return (
    <View style={{ width: 300 * s, alignItems: 'center' }} accessible accessibilityRole="image" accessibilityLabel="A handwritten note that reads: Call Ana before 4. Pick up the prints. Oat milk. The same words typed below it.">
      <Svg width={300 * s} height={150 * s} viewBox="0 0 300 150">
        <G transform="rotate(-3 150 75)">
          <Rect x={46} y={14} width={208} height={124} fill={theme.paper} stroke={theme.rule} strokeWidth={1.5} />
          {[44, 72, 100, 128].map((y) => (
            <Line key={y} x1={56} x2={244} y1={y + 4} y2={y + 4} stroke={theme.rule} strokeWidth={1} />
          ))}
          <Path d={penLine(62, 46, [4, 3, 6, 1], 10.5, 3)} stroke={theme.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <Path d={penLine(62, 74, [4, 2, 3, 6], 10.5, 9)} stroke={theme.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <Path d={penLine(62, 102, [3, 2], 10.5, 15)} stroke={theme.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </G>
      </Svg>
      <View style={[styles.typed, { borderTopColor: theme.rule }]} importantForAccessibility="no-hide-descendants">
        <Text style={[styles.typedLine, { color: theme.ink }]}>
          <Text style={{ backgroundColor: theme.highlightWash }}>Call Ana before 4.</Text>
        </Text>
        <Text style={[styles.typedLine, { color: theme.ink }]}>Pick up the prints.</Text>
        <Text style={[styles.typedLine, { color: theme.ink }]}>Oat milk.</Text>
      </View>
    </View>
  );
}

// ---------- onboarding 3: on the phone ----------

/** A phone in airplane mode with a page of text on it. */
export function OfflinePhone({ theme, width = 300 }: { theme: Theme; width?: number }) {
  const s = width / 300;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="A phone in airplane mode showing a page of text.">
      <Svg width={300 * s} height={260 * s} viewBox="0 0 300 260">
        <Rect x={92} y={8} width={116} height={244} rx={22} fill={theme.paper} stroke={theme.ink} strokeWidth={2.2} />
        <Rect x={132} y={18} width={36} height={8} rx={4} fill={theme.ink} />
        {/* airplane */}
        <Path d="M191 32 L180 28 L176 21 Q175 19 173.5 21 L174.5 27 L166 30 L163 28 L161.5 29 L163.5 32 L161.5 35 L163 36 L166 34 L174.5 37 L173.5 43 Q175 45 176 43 L180 36 Z" fill={theme.ink} />
        <Rect x={106} y={54} width={88} height={6} rx={3} fill={theme.ink} />
        {printRows(106, 72, 88, 9, 13, 21, theme.inkSoft, 4)}
        <Rect x={124} y={226} width={52} height={4} rx={2} fill={theme.rule} />
      </Svg>
    </View>
  );
}

// ---------- paywall: Clean up, before and after ----------

/** Two slips: lines broken where the page broke them, and the same text as a paragraph. */
export function CleanUpPair({ theme, compact = false }: { theme: Theme; compact?: boolean }) {
  const h = compact ? 92 : 124;
  return (
    <View style={styles.pair} accessible accessibilityRole="image" accessibilityLabel="Text with broken lines, and the same text cleaned up into a paragraph.">
      <Slip theme={theme} label="As read" height={h}>
        {[0.62, 0.8, 0.44, 0.7, 0.36, 0.66].slice(0, compact ? 4 : 6).map((w, i) => (
          <View key={i} style={[styles.bar, { width: `${w * 100}%`, backgroundColor: theme.inkSoft }]} />
        ))}
      </Slip>
      <Svg width={26} height={20} viewBox="0 0 26 20">
        <Path d="M2 10 Q13 9 22 10 M16 4 L22.5 10 L16 16" stroke={theme.ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Slip theme={theme} label="Clean up" height={h}>
        {[1, 1, 1, 0.5].map((w, i) => (
          <View key={i} style={[styles.bar, { width: `${w * 100}%`, backgroundColor: theme.ink }]} />
        ))}
        {!compact && <View style={{ height: 8 }} />}
        {!compact && [1, 0.7].map((w, i) => <View key={`b${i}`} style={[styles.bar, { width: `${w * 100}%`, backgroundColor: theme.ink }]} />)}
      </Slip>
    </View>
  );
}

function Slip({ theme, label, height, children }: { theme: Theme; label: string; height: number; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.slipLabel, { color: theme.inkSoft }]}>{label}</Text>
      <View style={[styles.slip, { height, backgroundColor: theme.paper, borderColor: theme.rule }]}>{children}</View>
    </View>
  );
}

// ---------- trial ----------

/** Three days, the second one ringed in ink: that is when the reminder comes. */
export function TrialDays({ theme }: { theme: Theme }) {
  return (
    <View style={styles.days} accessible accessibilityLabel="Day 1, day 2 with the reminder, day 3">
      {['Day 1', 'Day 2', 'Day 3'].map((d, i) => (
        <View key={d} style={styles.dayCol}>
          <View style={styles.day}>
            <Svg width={88} height={88} style={StyleSheet.absoluteFill}>
              <Rect x={8} y={8} width={72} height={72} fill={theme.paper} stroke={theme.rule} strokeWidth={1.5} />
              {i === 1 && (
                <Path d="M44 4 C 71 2, 87 22, 83 46 C 79 72, 51 86, 27 78 C 7 70, 1 44, 11 24 C 19 10, 35 4, 53 6" fill="none" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" />
              )}
            </Svg>
            <Text style={[styles.dayText, { color: theme.ink }]}>{d}</Text>
          </View>
          <Text style={[styles.dayNote, { color: i === 1 ? theme.ink : 'transparent' }]}>reminder</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  typed: { alignSelf: 'stretch', marginTop: 14, paddingTop: 14, paddingHorizontal: 34, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  typedLine: { fontSize: 20, lineHeight: 28 },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  slipLabel: { fontFamily: fonts.heading, fontSize: 14, marginBottom: 6 },
  slip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sheet, padding: 12, gap: 8 },
  bar: { height: 5, borderRadius: 3 },
  days: { flexDirection: 'row', gap: 12 },
  dayCol: { alignItems: 'center', gap: 6 },
  day: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontFamily: fonts.heading, fontSize: 19 },
  dayNote: { fontFamily: fonts.heading, fontSize: 15 },
});
