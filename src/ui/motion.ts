import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';

/** True while iOS Reduce Motion is on: sweeps and slides then jump straight to the end. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** The shutter: a firm tap. */
export const captureHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
/** Copied: the success pattern. */
export const copyHaptic = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
/** Picking things up and setting them down (page reorder, toggles). */
export const tick = () => Haptics.selectionAsync().catch(() => {});
