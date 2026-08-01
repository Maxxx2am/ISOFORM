import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Small pill segmented control (Metric/Imperial, Male/Female/Skip, etc.) —
 * shared by Settings and onboarding so both stay visually identical.
 * Spring-scale press gives a crisp, polished tap response on each segment. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: t.surface.sunken }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <SegItem
            key={String(o.value)}
            label={o.label}
            selected={on}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onChange(o.value);
            }}
          />
        );
      })}
    </View>
  );
}

function SegItem({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={4}
    >
      <Animated.View
        style={[
          styles.segItem,
          selected && { backgroundColor: t.ink.primary },
          { transform: [{ scale }] },
        ]}
      >
        <Text variant="caption" style={{ color: selected ? t.surface.base : t.ink.secondary }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: Radius.pill, padding: 2, gap: 2 },
  segItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.pill },
});
