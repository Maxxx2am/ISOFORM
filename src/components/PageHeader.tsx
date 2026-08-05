import type { ReactNode } from 'react';
import { View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Text } from '@/components/Text';
import { Spacing } from '@/theme/palette';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  trailing,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <>
      <View style={{ paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <BackButton />
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text variant="label" tone="muted">{eyebrow}</Text> : null}
          <Text variant="title">{title}</Text>
        </View>
        {trailing}
      </View>
      {subtitle ? <Text tone="secondary" style={{ marginTop: Spacing.xs }}>{subtitle}</Text> : null}
    </>
  );
}
