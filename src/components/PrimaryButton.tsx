import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

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

/**
 * Large, thumb-zone pill button. Primary = white on black (ISOMTRIC .btn-p),
 * outline = raised surface with a hairline (.btn-o), ghost = accent text (.btn-g).
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.88 : 1 },
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
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
  pressed: { transform: [{ scale: 0.98 }] },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
