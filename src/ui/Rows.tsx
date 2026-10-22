import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Theme, fonts } from '../theme';
import Glyph from './Glyph';
import { Tap } from './Tap';

/**
 * Lists are ruled paper: a slab heading, then rows split by hairlines,
 * full-bleed and square-edged. No boxes around groups.
 */
export function Group({
  theme,
  title,
  note,
  children,
  first = false,
}: {
  theme: Theme;
  title?: string;
  note?: string;
  children?: React.ReactNode;
  first?: boolean;
}) {
  return (
    <View style={{ paddingTop: first ? 10 : 32 }}>
      {title ? (
        <Text style={[styles.title, { color: theme.ink }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {note ? <Text style={[styles.note, { color: theme.inkSoft }]}>{note}</Text> : null}
      {children ? <View style={[styles.body, { borderTopColor: theme.rule }]}>{children}</View> : null}
    </View>
  );
}

/** One row: a label (and a line under it) on the left, a value or anything on the right. */
export function Row({
  theme,
  label,
  sub,
  value,
  onPress,
  danger = false,
  chevron,
  children,
  a11y,
}: {
  theme: Theme;
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  children?: React.ReactNode;
  a11y?: string;
}) {
  const body = (
    <>
      <View style={styles.words}>
        <Text style={[styles.label, { color: danger ? theme.danger : theme.ink }]}>{label}</Text>
        {sub ? <Text style={[styles.sub, { color: theme.inkFaint }]}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[styles.value, { color: theme.inkSoft }]}>{value}</Text> : null}
      {children}
      {(chevron ?? (onPress != null && !danger)) ? <Glyph name="chevron" size={18} color={theme.inkFaint} /> : null}
    </>
  );
  const style = [styles.row, { borderBottomColor: theme.rule }];
  return onPress ? (
    <Tap
      onPress={onPress}
      style={style}
      pressedStyle={{ backgroundColor: theme.sunk }}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? (value ? `${label}, ${value}` : label)}
      accessibilityHint={sub}
    >
      {body}
    </Tap>
  ) : (
    <View style={style} accessible={!children} accessibilityLabel={a11y}>
      {body}
    </View>
  );
}

/** A row with an on/off switch. The thumb is dimmed on dim paper. */
export function SwitchRow({
  theme,
  label,
  sub,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row theme={theme} label={label} sub={sub}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.ink, false: theme.rule }}
        thumbColor={theme.thumb}
        ios_backgroundColor={theme.rule}
        accessibilityLabel={label}
        accessibilityHint={sub}
      />
    </Row>
  );
}

/** A choice in a list, ticked in ink when on. */
export function CheckRow({
  theme,
  label,
  sub,
  on,
  onPress,
}: {
  theme: Theme;
  label: string;
  sub?: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Tap
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.rule }]}
      pressedStyle={{ backgroundColor: theme.sunk }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <View style={styles.words}>
        <Text style={[styles.label, { color: theme.ink }]}>{label}</Text>
        {sub ? <Text style={[styles.sub, { color: theme.inkFaint }]}>{sub}</Text> : null}
      </View>
      <View style={{ width: 26, alignItems: 'center' }}>{on ? <Glyph name="check" size={24} color={theme.ink} weight={2.2} /> : null}</View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.heading, fontSize: 21, paddingHorizontal: 20, marginBottom: 2 },
  note: { fontSize: 15, lineHeight: 21, paddingHorizontal: 20, marginTop: 2 },
  body: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  words: { flex: 1, paddingVertical: 12 },
  label: { fontSize: 17 },
  sub: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  value: { fontSize: 16, flexShrink: 1, textAlign: 'right' },
});
