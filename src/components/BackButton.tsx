import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { Radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** ISOMTRIC-style circular back button with spring-scale press for a crisp,
 * polished tap response. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    (onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))))();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[styles.btn, { backgroundColor: t.surface.sunken, transform: [{ scale }] }]}
      >
        <Ionicons name="chevron-back" size={20} color={t.ink.primary} />
      </Animated.View>
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
