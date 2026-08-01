/** Resolves the active theme: dark surfaces + the user-selected accent. Only
 * dark exists — a light theme was never actually distinct enough to be worth
 * the doubled palette/QA surface, so the app just commits to one look. */
import { useMemo } from 'react';

import { useSettings } from '@/store/settings';
import { Accents, Feedback, Ink, Radius, Spacing, Surface, Typography } from '@/theme/palette';

export function useTheme() {
  const accentId = useSettings((s) => s.accent);
  return useMemo(() => ({
    mode: 'dark' as const,
    surface: Surface,
    ink: Ink,
    feedback: Feedback,
    accent: Accents[accentId],
    spacing: Spacing,
    radius: Radius,
    typography: Typography,
  }), [accentId]);
}

export type Theme = ReturnType<typeof useTheme>;
