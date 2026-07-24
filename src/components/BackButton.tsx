import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** ISOMTRIC-style circular back button for pushed screens. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)')))}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: pressed ? t.surface.pressed : t.surface.sunken },
      ]}
    >
      <Ionicons name="chevron-back" size={20} color={t.ink.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
