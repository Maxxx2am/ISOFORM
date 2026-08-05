import { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Text } from '@/components/Text';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Variant = 'primary' | 'outline' | 'ghost' | 'hero';

type PrimaryButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Large, thumb-zone pill button. Primary = white on black (ISOMTRIC .btn-p),
 * outline = raised surface with a hairline (.btn-o), ghost = accent text
 * (.btn-g). `hero` is a distinct fourth variant — solid brand amber,
 * uppercase, wider letter-spacing — reserved for genuine "go do the thing"
 * moments (start a workout, the paywall's main CTA), not every button.
 *
 * Press: spring-scale bounce (0.97) with native driver for instant response,
 * plus haptic tap. Opacity-only press states (the old approach) read as
 * sluggish and generic next to a proper spring — this is one of those tiny
 * details that separates "AI-made" from polished.
 */
export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
}: PrimaryButtonProps) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  const bg =
    variant === 'primary' ? t.ink.primary : variant === 'hero' ? t.accent.color : variant === 'outline' ? t.surface.raised : 'transparent';
  const fg =
    variant === 'primary' ? t.surface.base : variant === 'hero' ? t.accent.onColor : variant === 'ghost' ? t.accent.color : t.ink.primary;
  const border = variant === 'outline' ? t.ink.hairline : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled || loading}
    >
      <Animated.View
        style={[
          styles.base,
          variant === 'hero' ? styles.baseHero : null,
          { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : 1, transform: [{ scale }] },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.content}>
            {variant !== 'hero' ? icon : null}
            <Text
              variant="heading"
              style={
                variant === 'hero'
                  ? { color: fg, fontSize: 17, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' }
                  : { color: fg, letterSpacing: -0.2 }
              }
            >
              {label}
            </Text>
            {variant === 'hero' ? icon : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
    paddingHorizontal: Spacing.lg,
  },
  baseHero: { minHeight: 58, paddingVertical: 17, borderRadius: Radius.md },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
