import { Ionicons } from '@expo/vector-icons';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
  /** Right-side content: a value, tag, switch… */
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  /** Reduce opacity — for locked items. */
  dimmed?: boolean;
};

export function ListRow({ title, subtitle, right, onPress, chevron, dimmed }: ListRowProps) {
  const t = useTheme();
  const body = (
    <>
      <View style={styles.rowBody}>
        <Text variant="body" numberOfLines={1} tone={dimmed ? 'muted' : 'primary'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ?? !!onPress ? <Ionicons name="chevron-forward" size={17} color={t.ink.muted} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, dimmed && { opacity: 0.5 }]}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, dimmed && { opacity: 0.55 }, pressed && { backgroundColor: t.surface.sunken }]}>
      {body}
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
  group: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowBody: { flex: 1, gap: 2 },
  label: { marginBottom: Spacing.sm, marginLeft: 4 },
});
