import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/theme/useTheme';
import type { TypographyVariant } from '@/theme/palette';

type Tone = 'primary' | 'secondary' | 'muted' | 'accent';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  tone?: Tone;
};

export function Text({ variant = 'body', tone = 'primary', style, ...rest }: TextProps) {
  const t = useTheme();
  const color =
    tone === 'accent'
      ? t.accent.color
      : tone === 'secondary'
        ? t.ink.secondary
        : tone === 'muted'
          ? t.ink.muted
          : t.ink.primary;

  const transform = variant === 'label' ? styles.upper : undefined;
  return <RNText style={[t.typography[variant], transform, { color }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
});
