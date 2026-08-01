import { StyleSheet, View } from 'react-native';

import { NumberField } from '@/components/NumberField';
import { Text } from '@/components/Text';
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg, useProfile } from '@/store/profile';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Height/weight/age entry, reading and writing `useProfile` directly — the
 * one source of truth for body stats, shared by Settings and onboarding so
 * filling this in during onboarding IS filling in Settings, not a separate
 * copy of the same data. */
export function BodyStatsFields() {
  const t = useTheme();
  const profile = useProfile();
  const imperial = profile.units === 'imperial';

  const heightDisplay = profile.heightCm != null ? cmToFeetInches(profile.heightCm) : null;
  const weightDisplay = profile.weightKg != null ? Math.round(kgToLb(profile.weightKg)) : null;

  return (
    <View style={[styles.bodyCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
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
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
          Weight
        </Text>
        <NumberField
          value={imperial ? weightDisplay : profile.weightKg != null ? Math.round(profile.weightKg) : null}
          placeholder={imperial ? 'lb' : 'kg'}
          style={{ flex: 1 }}
          onChange={(v) => profile.setWeightKg(v != null ? (imperial ? lbToKg(v) : v) : null)}
        />
      </View>
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
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

const styles = StyleSheet.create({
  bodyCard: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  bodyLabel: { width: 60 },
});
