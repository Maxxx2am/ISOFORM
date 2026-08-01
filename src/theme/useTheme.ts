/** Resolves the active theme: dark surfaces + ISOFORM's fixed brand accent.
 * Only dark exists — a light theme was never actually distinct enough to be
 * worth the doubled palette/QA surface, so the app just commits to one look.
 * Accent is fixed brand identity, not a user preference. */
import { useMemo } from 'react';

import { Brand, Feedback, Ink, Radius, Spacing, Surface, Typography } from '@/theme/palette';

export function useTheme() {
  return useMemo(
    () => ({
      mode: 'dark' as const,
      surface: Surface,
      ink: Ink,
      feedback: Feedback,
      accent: Brand.primary,
      spacing: Spacing,
      radius: Radius,
      typography: Typography,
    }),
    [],
  );
}

export type Theme = ReturnType<typeof useTheme>;
