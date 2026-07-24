/**
 * ISOFORM design tokens — matched to the ISOMTRIC app's visual language.
 *
 * True black base, monochrome by default (white is the primary), Apple-style
 * rounded cards with white-alpha hairline borders, pill buttons, tight display
 * type, uppercase small-caps labels, tabular numerals. Accent tints are optional
 * and used sparingly (skeleton, progress ring, active states, links).
 */
import { Platform } from 'react-native';

export type SurfaceSet = {
  base: string;
  raised: string;
  sunken: string;
  pressed: string;
};
export type InkSet = {
  primary: string;
  secondary: string;
  muted: string;
  hairline: string;
  hairlineStrong: string;
};

/** Near-black elevation ramp (ISOMTRIC dark: --bg / --s1 / --s2 / --s3). */
export const Surface: SurfaceSet = {
  /** True black — app background. */
  base: '#000000',
  /** Cards, lists, sheets. */
  raised: '#141416',
  /** Inputs, nested cells. */
  sunken: '#202024',
  /** Pressed / selected fill. */
  pressed: '#2C2C31',
};

export const Ink: InkSet = {
  primary: '#FFFFFF',
  secondary: '#9A9AA1',
  muted: '#5E5E66',
  hairline: 'rgba(255,255,255,0.07)',
  hairlineStrong: 'rgba(255,255,255,0.13)',
};

/** Apple system semantic colors (ISOMTRIC --red / --amber / --green). */
export const Feedback = {
  good: '#30D158',
  warn: '#FF9F0A',
  bad: '#FF453A',
} as const;

/** Map a 0-100 form quality to a feedback color. */
export function formQualityColor(quality: number): string {
  if (quality >= 80) return Feedback.good;
  if (quality >= 50) return Feedback.warn;
  return Feedback.bad;
}

/**
 * Selectable accents. `mono` (white) is the default — matching ISOMTRIC's
 * "pure monochrome" look; the rest are its optional Apple-hue tints.
 */
export const Accents = {
  mono: { id: 'mono', label: 'Mono', color: '#FFFFFF', onColor: '#000000' },
  purple: { id: 'purple', label: 'Purple', color: '#BF5AF2', onColor: '#FFFFFF' },
  orange: { id: 'orange', label: 'Orange', color: '#FF9F0A', onColor: '#000000' },
  blue: { id: 'blue', label: 'Blue', color: '#0A84FF', onColor: '#FFFFFF' },
  green: { id: 'green', label: 'Green', color: '#30D158', onColor: '#000000' },
  teal: { id: 'teal', label: 'Teal', color: '#5AC8FA', onColor: '#000000' },
  pink: { id: 'pink', label: 'Pink', color: '#FF3CA0', onColor: '#FFFFFF' },
} as const;

export type AccentId = keyof typeof Accents;
export const DEFAULT_ACCENT: AccentId = 'mono';

/** 4pt spacing scale. Page gutter is 20 (ISOMTRIC). */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  page: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Rounded, iOS-like. Cards 20–24, buttons/pills 999, sheets 28. */
export const Radius = {
  sm: 14,
  md: 20,
  lg: 24,
  sheet: 28,
  pill: 999,
} as const;

const numeric = Platform.select({ ios: 'ui-monospace', default: 'monospace' });

export const Typography = {
  /** Big timer / metric numerals. */
  display: { fontSize: 56, fontWeight: '800' as const, letterSpacing: -1.5 },
  /** Page title (ISOMTRIC .page-title). */
  title: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -1, lineHeight: 38 },
  /** Section / card heading. */
  heading: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.4 },
  /** Hero quote style. */
  hero: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.8, lineHeight: 35 },
  body: { fontSize: 16, fontWeight: '500' as const },
  /** Secondary caption (ISOMTRIC .eyebrow). */
  caption: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.1 },
  /** Uppercase small-caps label (ISOMTRIC .lbl). */
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.3 },
  mono: { fontSize: 16, fontWeight: '600' as const, fontFamily: numeric },
} as const;

export type TypographyVariant = keyof typeof Typography;
