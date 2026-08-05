import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Children, Fragment, useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/**
 * ISOMTRIC-style grouped list: ONE rounded container, rows divided by
 * hairlines. Far calmer than a stack of individually-bordered cards.
 */
export function ListGroup({ children }: { children: ReactNode }) {
  const t = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={[styles.divider, { backgroundColor: t.ink.hairline }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Leading icon/glyph, before the title/subtitle column. */
  icon?: ReactNode;
  /** Right-side content: a value, tag, switch… */
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  /** Reduce opacity — for locked items. */
  dimmed?: boolean;
};

export function ListRow({ title, subtitle, icon, right, onPress, onLongPress, chevron, dimmed }: ListRowProps) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scale, { toValue: 0.985, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();
  };

  const body = (
    <>
      {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
      <View style={styles.rowBody}>
        <Text variant="body" numberOfLines={1} tone={dimmed ? 'secondary' : 'primary'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ?? !!onPress ? <Ionicons name="chevron-forward" size={17} color={t.ink.muted} /> : null}
    </>
  );
  if (!onPress && !onLongPress) return <View style={[styles.row, dimmed && { opacity: 0.55 }]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        dimmed && { opacity: 0.55 },
        pressed && { backgroundColor: t.surface.sunken },
      ]}
    >
      <Animated.View style={[styles.row, { transform: [{ scale }] }]}>
        {body}
      </Animated.View>
    </Pressable>
  );
}

/** Uppercase section label + optional trailing node, above a group. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text variant="label" tone="muted" style={styles.label}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: Radius.md, borderWidth: 0, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 16,
    minHeight: 58,
  },
  rowBody: { flex: 1, gap: 2 },
  iconSlot: { width: 22, alignItems: 'center', justifyContent: 'center' },
  label: { marginBottom: Spacing.sm, marginLeft: 4 },
});
