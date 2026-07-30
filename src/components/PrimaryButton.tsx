import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';

import { Text } from '@/components/Text';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Variant = 'primary' | 'outline' | 'ghost';

type PrimaryButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

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

  const handlePressIn = () => {
    if (disabled || loading) return;
    Animated.spring(scale, {
      toValue: 0.97,
      tension: 400,
      friction: 25,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    Animated.spring(scale, {
      toValue: 1,
      tension: 400,
      friction: 18,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  const bg =
    variant === 'primary' ? t.ink.primary : variant === 'outline' ? t.surface.raised : 'transparent';
  const fg =
    variant === 'primary' ? t.surface.base : variant === 'ghost' ? t.accent.color : t.ink.primary;
  const border = variant === 'outline' ? t.ink.hairline : 'transparent';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: isDisabled ? 0.4 : 1,
        },
        variant === 'primary' && !isDisabled ? styles.shadow : null,
        style,
      ]}
    >
      <Animated.View style={[styles.content, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text variant="heading" style={{ color: fg, letterSpacing: -0.2 }}>
              {label}
            </Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
    paddingHorizontal: Spacing.lg,
  },
  shadow: {
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
