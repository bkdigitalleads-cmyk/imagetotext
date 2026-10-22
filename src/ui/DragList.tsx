import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { Theme } from '../theme';
import Glyph from './Glyph';
import { tick } from './motion';

/**
 * A short list you reorder by dragging the grip on each row. Rows have a
 * fixed height. VoiceOver gets "Move up" and "Move down" actions instead of
 * the drag. No gesture library: plain PanResponder.
 */
export default function DragList<T>({
  theme,
  items,
  keyOf,
  rowHeight,
  renderRow,
  labelOf,
  onMove,
}: {
  theme: Theme;
  items: T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  labelOf: (item: T, index: number) => string;
  onMove: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const live = useRef({ items, onMove, rowHeight });
  live.current = { items, onMove, rowHeight };

  const target = drag ? clamp(Math.round((drag.from * rowHeight + drag.dy) / rowHeight), 0, items.length - 1) : -1;

  const responders = useMemo(
    () =>
      items.map((_, i) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: () => {
            tick();
            setDrag({ from: i, dy: 0 });
          },
          onPanResponderMove: (_e, g) => setDrag({ from: i, dy: g.dy }),
          onPanResponderRelease: (_e, g) => {
            const { items: list, rowHeight: rh, onMove: move } = live.current;
            const to = clamp(Math.round((i * rh + g.dy) / rh), 0, list.length - 1);
            setDrag(null);
            if (to !== i) {
              tick();
              move(i, to);
            }
          },
          onPanResponderTerminate: () => setDrag(null),
        })
      ),
    [items.length]
  );

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((item, i) => {
        let offset = 0;
        if (drag) {
          if (i === drag.from) offset = drag.dy;
          else if (drag.from < i && i <= target) offset = -rowHeight;
          else if (target <= i && i < drag.from) offset = rowHeight;
        }
        const lifted = drag?.from === i;
        return (
          <View
            key={keyOf(item)}
            style={[
              styles.row,
              { top: i * rowHeight, height: rowHeight, borderBottomColor: theme.rule, backgroundColor: lifted ? theme.paper : 'transparent' },
              { transform: [{ translateY: offset }], zIndex: lifted ? 2 : 1 },
              lifted && { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
            ]}
            accessible
            accessibilityLabel={labelOf(item, i)}
            accessibilityActions={[
              ...(i > 0 ? [{ name: 'moveUp', label: 'Move up' }] : []),
              ...(i < items.length - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []),
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'moveUp') onMove(i, i - 1);
              if (e.nativeEvent.actionName === 'moveDown') onMove(i, i + 1);
            }}
          >
            <View style={{ flex: 1 }}>{renderRow(item, i)}</View>
            <View {...responders[i]?.panHandlers} style={styles.grip} hitSlop={8}>
              <Glyph name="grip" size={26} color={theme.inkSoft} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingLeft: 20 },
  grip: { width: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
