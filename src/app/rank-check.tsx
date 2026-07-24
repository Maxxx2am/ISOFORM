import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Confetti } from '@/components/Confetti';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EXERCISES } from '@/exercises/data';
import type { Exercise } from '@/exercises/types';
import { searchExercises } from '@/lib/search';
import { RANK_ICON_ASPECT, RANK_ICONS, rankForValue, rankColor, type RankTier } from '@/lib/rank';
import { useProfile, type Sex } from '@/store/profile';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Result = { tier: RankTier; exercise: Exercise; value: number };

/**
 * A fun calculator, not a tracker: enter someone's stats + a claimed number
 * (no camera, no session needed) and see what rank it'd land — same formula
 * as "Your rank" in Insights, just fed a one-off value instead of your
 * tracked history. Kept as its own entry point rather than living behind the
 * rank "?" button, since that button explains YOUR rank — this checks
 * anyone's.
 */
export default function RankCheckScreen() {
  const t = useTheme();
  const profile = useProfile();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [query, setQuery] = useState('');
  const [valueText, setValueText] = useState('');
  const [heightCm, setHeightCm] = useState<number | null>(profile.heightCm);
  const [weightKg, setWeightKg] = useState<number | null>(profile.weightKg);
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [age, setAge] = useState<number | null>(profile.age);
  const [result, setResult] = useState<Result | null>(null);

  const results = useMemo(() => searchExercises(query, EXERCISES), [query]);
  const value = Number(valueText);
  const canReveal = exercise != null && Number.isFinite(value) && value > 0;

  const reveal = () => {
    if (!exercise || !canReveal) return;
    const r = rankForValue(exercise, value, { heightCm, weightKg, sex, age });
    setResult({ tier: r.tier, exercise, value });
  };

  const reset = () => {
    setResult(null);
    setExercise(null);
    setQuery('');
    setValueText('');
  };

  if (result) {
    return <RevealScreen result={result} onCheckAnother={reset} />;
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <BackButton />
        <Text variant="title">Check a rank</Text>
      </View>
      <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
        Enter someone&apos;s stats and a number — no camera or account needed.
      </Text>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Exercise</SectionLabel>
        {exercise ? (
          <Pressable
            onPress={() => setExercise(null)}
            style={[styles.selectedExercise, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="heading">{exercise.name}</Text>
              <Text variant="caption" tone="secondary">
                {exercise.mode === 'hold' ? 'Hold — enter seconds' : 'Reps — enter a count'}
              </Text>
            </View>
            <Text variant="caption" tone="accent">Change</Text>
          </Pressable>
        ) : (
          <>
            <View style={[styles.search, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
              <Ionicons name="search" size={16} color={t.ink.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search movements"
                placeholderTextColor={t.ink.muted}
                style={[styles.searchInput, { color: t.ink.primary }]}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <View style={{ marginTop: Spacing.sm }}>
              <ListGroup>
                {results.slice(0, 8).map((ex) => (
                  <ListRow key={ex.id} title={ex.name} subtitle={ex.summary} chevron onPress={() => setExercise(ex)} />
                ))}
              </ListGroup>
            </View>
          </>
        )}
      </View>

      {exercise ? (
        <>
          <View style={{ marginTop: Spacing.lg }}>
            <SectionLabel>{exercise.mode === 'hold' ? 'Seconds held' : 'Reps'}</SectionLabel>
            <TextInput
              value={valueText}
              onChangeText={setValueText}
              placeholder={exercise.mode === 'hold' ? 'e.g. 45' : 'e.g. 20'}
              placeholderTextColor={t.ink.muted}
              keyboardType="number-pad"
              style={[styles.valueInput, { color: t.ink.primary, borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
            />
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionLabel>Their stats (optional)</SectionLabel>
            <View style={[styles.statsCard, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}>
              <View style={styles.statRow}>
                <Text variant="label" tone="muted" style={styles.statLabel}>Height</Text>
                <NumberField value={heightCm != null ? Math.round(heightCm) : null} placeholder="cm" onChange={setHeightCm} />
              </View>
              <View style={styles.statRow}>
                <Text variant="label" tone="muted" style={styles.statLabel}>Weight</Text>
                <NumberField value={weightKg != null ? Math.round(weightKg) : null} placeholder="kg" onChange={setWeightKg} />
              </View>
              <View style={styles.statRow}>
                <Text variant="label" tone="muted" style={styles.statLabel}>Age</Text>
                <NumberField value={age} placeholder="years" onChange={setAge} />
              </View>
              <View style={[styles.statRow, { alignItems: 'center' }]}>
                <Text variant="label" tone="muted" style={styles.statLabel}>Sex</Text>
                <View style={styles.sexRow}>
                  {(['male', 'female', 'unspecified'] as const).map((v) => {
                    const on = sex === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setSex(v)}
                        style={[styles.sexChip, { borderColor: on ? t.ink.primary : t.ink.hairline, backgroundColor: on ? t.ink.primary : 'transparent' }]}
                      >
                        <Text variant="caption" style={{ color: on ? t.surface.base : t.ink.secondary }}>
                          {v === 'unspecified' ? 'Skip' : v === 'male' ? 'Male' : 'Female'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>

          <PrimaryButton label="Reveal rank" disabled={!canReveal} onPress={reveal} style={{ marginTop: Spacing.xl }} />
        </>
      ) : null}
    </Screen>
  );
}

function RevealScreen({ result, onCheckAnother }: { result: Result; onCheckAnother: () => void }) {
  const [showConfetti, setShowConfetti] = useState(true);
  const color = rankColor(result.tier);
  const valueLabel = result.exercise.mode === 'hold' ? `${result.value}s hold` : `${result.value} reps`;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
      <View style={styles.headerRow}>
        <BackButton />
      </View>
      <View style={styles.revealBody}>
        <Text variant="label" tone="muted" style={{ letterSpacing: 3 }}>
          RANK
        </Text>
        <Image
          source={RANK_ICONS[result.tier]}
          style={{ height: 220, aspectRatio: RANK_ICON_ASPECT[result.tier], marginTop: Spacing.md }}
          resizeMode="contain"
        />
        <Text variant="title" style={{ color, marginTop: Spacing.md, fontSize: 34 }}>
          {result.tier}
        </Text>
        <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
          {result.exercise.name}
        </Text>
        <Text variant="heading" style={{ fontSize: 26, marginTop: 2 }}>
          {valueLabel}
        </Text>
      </View>
      <View style={{ gap: Spacing.sm }}>
        <PrimaryButton label="Check another" variant="outline" onPress={onCheckAnother} />
      </View>
      <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.md, paddingHorizontal: Spacing.lg }}>
        A rough, hand-tuned estimate — not a scientific or certified assessment.
      </Text>
    </Screen>
  );
}

function NumberField({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
}) {
  const t = useTheme();
  const [text, setText] = useState(value != null ? String(value) : '');
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
      style={{ flex: 1, height: 40, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.sm, color: t.ink.primary, borderColor: t.ink.hairline }}
    />
  );
}

const styles = StyleSheet.create({
  headerRow: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '500', paddingVertical: 0 },
  selectedExercise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  valueInput: { height: 48, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, fontSize: 16, fontWeight: '600' },
  statsCard: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.sm },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statLabel: { width: 60 },
  sexRow: { flexDirection: 'row', gap: Spacing.sm, flex: 1 },
  sexChip: { flex: 1, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center' },
  revealBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
