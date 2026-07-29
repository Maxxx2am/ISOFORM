import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg, useProfile } from '@/store/profile';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export function BodyStatsFields() {
  const t = useTheme();
  const profile = useProfile();
  const imperial = profile.units === 'imperial';

  const heightDisplay =
    imperial && profile.heightCm != null
      ? cmToFeetInches(profile.heightCm)
      : null;
  const weightDisplay =
    imperial && profile.weightKg != null
      ? Math.round(kgToLb(profile.weightKg))
      : null;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: t.ink.hairline,
          backgroundColor: t.surface.sunken,
        },
      ]}
    >
      <View style={styles.row}>
        <Text variant="label" tone="muted" style={styles.label}>
          Height
        </Text>
        {imperial ? (
          <View style={{ flexDirection: 'row', gap: Spacing.sm, flex: 1 }}>
            <NumberField
              value={heightDisplay?.feet ?? null}
              placeholder="ft"
              style={{ flex: 1 }}
              onChange={(feet) => {
                const inches = heightDisplay?.inches ?? 0;
                profile.setHeightCm(feet != null ? feetInchesToCm(feet, inches) : null);
              }}
            />
            <NumberField
              value={heightDisplay?.inches ?? null}
              placeholder="in"
              style={{ flex: 1 }}
              onChange={(inches) => {
                const feet = heightDisplay?.feet ?? 0;
                profile.setHeightCm(inches != null ? feetInchesToCm(feet, inches) : null);
              }}
            />
          </View>
        ) : (
          <NumberField
            value={profile.heightCm != null ? Math.round(profile.heightCm) : null}
            placeholder="cm"
            style={{ flex: 1 }}
            onChange={(cm) => profile.setHeightCm(cm)}
          />
        )}
      </View>
      <View style={styles.row}>
        <Text variant="label" tone="muted" style={styles.label}>
          Weight
        </Text>
        <NumberField
          value={
            imperial
              ? weightDisplay
              : profile.weightKg != null
                ? Math.round(profile.weightKg)
                : null
          }
          placeholder={imperial ? 'lb' : 'kg'}
          style={{ flex: 1 }}
          onChange={(v) =>
            profile.setWeightKg(v != null ? (imperial ? lbToKg(v) : v) : null)
          }
        />
      </View>
      <View style={styles.row}>
        <Text variant="label" tone="muted" style={styles.label}>
          Age
        </Text>
        <NumberField
          value={profile.age}
          placeholder="years"
          style={{ flex: 1 }}
          onChange={(age) => profile.setAge(age)}
        />
      </View>
    </View>
  );
}

function NumberField({
  value,
  placeholder,
  onChange,
  style,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
  style?: object;
}) {
  const t = useTheme();
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(v) => {
        setText(v);
        if (v.trim() === '') {
          onChange(null);
          return;
        }
        const n = Number(v);
        if (!Number.isNaN(n) && n >= 0) onChange(n);
      }}
      placeholder={placeholder}
      placeholderTextColor={t.ink.muted}
      keyboardType="number-pad"
      style={[
        {
          height: 40,
          borderRadius: Radius.md,
          borderWidth: 1,
          paddingHorizontal: Spacing.sm,
          color: t.ink.primary,
          borderColor: t.ink.hairline,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  label: { width: 60 },
});
