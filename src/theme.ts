import { useColorScheme } from 'react-native';

/**
 * "A highlighter on paper." Warm off-white paper, ink-black text, and one
 * yellow-green highlighter. The highlighter is used for two things only:
 * the live action on a screen (the one thing to do next) and recognized
 * text you have selected. Everything else is ink on paper.
 *
 * Night is dim paper, not black: a warm grey sheet under a reading lamp,
 * ink that is soft cream instead of white, and a highlighter turned down so
 * it does not glow.
 */
export interface Theme {
  /** The desk under the paper: the page background. */
  bg: string;
  /** A sheet laid on it: thumbnails, trays, the text column. */
  paper: string;
  /** A shade below the page: pressed rows, wells. */
  sunk: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  /** Hairlines, ruled lines, dashed ghosts. */
  rule: string;
  /** The highlighter. Live action and text selection only. */
  highlight: string;
  /** Ink drawn on the highlighter (always dark, like real ink on a real highlight). */
  onHighlight: string;
  /** The highlighter laid thin, for a selected word in running text. */
  highlightWash: string;
  danger: string;
  /** The paper's shadow edge and the camera's dim surround. */
  shade: string;
  /** Switch thumb: iOS draws it pure white otherwise, too bright on dim paper. */
  thumb: string;
  isDark: boolean;
}

export const lightTheme: Theme = {
  bg: '#F4EFE4',
  paper: '#FBF8F1',
  sunk: '#EAE3D4',
  ink: '#1D1B17',
  inkSoft: '#57524A',
  inkFaint: '#8A8375',
  rule: '#DCD4C3',
  highlight: '#D4EE3C',
  onHighlight: '#1D1B17',
  highlightWash: 'rgba(212, 238, 60, 0.55)',
  danger: '#A13A2B',
  shade: 'rgba(29, 27, 23, 0.10)',
  thumb: '#FBF8F1',
  isDark: false,
};

export const darkTheme: Theme = {
  bg: '#262420',
  paper: '#2F2C27',
  sunk: '#1F1D1A',
  ink: '#E7E0D0',
  inkSoft: '#B5AD9C',
  inkFaint: '#877F70',
  rule: '#403B34',
  highlight: '#B4CC3A',
  onHighlight: '#1D1B17',
  highlightWash: 'rgba(180, 204, 58, 0.42)',
  danger: '#D98C7B',
  shade: 'rgba(0, 0, 0, 0.28)',
  thumb: '#E7E0D0',
  isDark: true,
};

/** Follows the system setting, so dim paper comes on with iOS Dark Mode. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}

/**
 * Corners, used on purpose:
 *  - pill: the live action and the toolbar buttons, the things a thumb presses
 *  - sheet: paper (thumbnails, trays) is nearly square, like a real page
 *  - lists are square-edged and full-bleed, split by ruled lines
 */
export const radius = { pill: 999, sheet: 3, tray: 18 };

export const fonts = {
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  /**
   * Zilla Slab (SIL OFL, assets/fonts/OFL-ZillaSlab.txt), a slab with a
   * typewriter's plainness, for headers and counts only. It has tabular
   * figures; counts set `tabular` below so they never jitter. Never combine
   * with fontWeight: the weight is in the file.
   */
  display: 'ZillaSlab-SemiBold',
  heading: 'ZillaSlab-Medium',
};

/** Spread into a Text style for counts: figures of equal width. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

/** The recognized text: the system font at a reading size, with real paragraph spacing. */
export const reading = { fontSize: 19, lineHeight: 29, paragraphGap: 16 };

/** Font files for useFonts in App.tsx. */
export const FONT_FILES = {
  [fonts.display]: require('../assets/fonts/ZillaSlab_600SemiBold.ttf'),
  [fonts.heading]: require('../assets/fonts/ZillaSlab_500Medium.ttf'),
};
