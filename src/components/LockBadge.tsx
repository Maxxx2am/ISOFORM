import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

/**
 * Chain-and-padlock badge for locked content — used in the Train list and the
 * exercise detail paywall screen so "locked" reads as a clear, consistent
 * visual instead of a bare lock glyph.
 */
export function LockBadge({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const t = useTheme();
  const big = size === 'lg';
  const dim = big ? 72 : 28;
  const iconSize = big ? 32 : 15;
  return (
    <View
      style={[
        styles.badge,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: t.surface.sunken,
          borderColor: t.ink.hairlineStrong,
        },
        big && { borderWidth: 1.5 },
      ]}
    >
      <MaterialCommunityIcons name="link-lock" size={iconSize} color={t.ink.secondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
