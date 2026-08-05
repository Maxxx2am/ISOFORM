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

/** Convert a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) to an rgba() string
 *  with a given alpha override. Single source of truth for every "brand/feedback
 *  color at reduced opacity" in the app — no more hardcoded `rgba(48,209,88,…)`
 *  that drifts when the token changes. */
export function alpha(hex: string, opacity: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/** Near-black elevation ramp (ISOMTRIC dark: --bg / --s1 / --s2 / --s3). */
export const Surface: SurfaceSet = {
  /** True black — app background. */
  base: '#070908',
  /** Cards, lists, sheets. */
  raised: '#101512',
  /** Inputs, nested cells. */
  sunken: '#0C110E',
  /** Pressed / selected fill. */
  pressed: '#18231C',
};

export const Ink: InkSet = {
  primary: '#FFFFFF',
  secondary: '#A7B0AA',
  muted: '#69756D',
  hairline: 'rgba(255,255,255,0.07)',
  hairlineStrong: 'rgba(255,255,255,0.13)',
};

/** Apple system semantic colors (ISOMTRIC --red / --amber / --green).
 * `warn` is deliberately a true yellow, not amber — it used to be nearly
 * identical to the brand accent (#EF9F27), so a mid-range form score and a
 * brand-colored badge/CTA read as the same thing on the same screen. */
export const Feedback = {
  good: '#82f300',
  warn: '#FFD60A',
  bad: '#FF453A',
} as const;

/** Map a 0-100 form quality to a feedback color: 70-100 green, 40-70 yellow,
 * 0-40 red — classic traffic-light tiering. */
export function formQualityColor(quality: number): string {
  if (quality >= 70) return Feedback.good;
  if (quality >= 40) return Feedback.warn;
  return Feedback.bad;
}

/**
 * ISOFORM's fixed brand identity — not user-selectable. A bright, athletic
 * "sport green" — deliberately more lime/volt than `Feedback.good`'s softer
 * Apple-system green, so a brand CTA and a "good score" state read as two
 * different things, not the same green twice.
 */
export const Brand = {
  primary: { color: '#82f300', onColor: '#04240A' },
} as const;

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
  sm: 10,
  md: 16,
  lg: 20,
  sheet: 26,
  pill: 999,
} as const;

const numeric = Platform.select({ ios: 'ui-monospace', default: 'monospace' });

export const Typography = {
  /** Big timer / metric numerals. */
  display: { fontSize: 56, fontWeight: '800' as const, letterSpacing: -1.5 },
  /** Page title (ISOMTRIC .page-title). */
  title: { fontSize: 38, fontWeight: '800' as const, letterSpacing: -1.4, lineHeight: 42 },
  /** Section / card heading. */
  heading: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.35 },
  /** Hero quote style. */
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -1, lineHeight: 38 },
  body: { fontSize: 15, fontWeight: '500' as const },
  /** Secondary caption (ISOMTRIC .eyebrow). */
  caption: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.1 },
  /** Uppercase small-caps label (ISOMTRIC .lbl). */
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.3 },
  mono: { fontSize: 16, fontWeight: '600' as const, fontFamily: numeric },
} as const;

export const Accents = {
  green: { id: 'green', label: 'Green', color: '#82f300', onColor: '#000000' },
} as const;
export type AccentId = keyof typeof Accents;
export const DEFAULT_ACCENT: AccentId = 'green';

export type TypographyVariant = keyof typeof Typography;
