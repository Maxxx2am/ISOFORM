import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { GoalPickerSheet } from '@/components/GoalPicker';
import { LockBadge } from '@/components/LockBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise, getNextProgression } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useWorkouts } from '@/store/workouts';
import { listSessions, type SessionRecord } from '@/storage/db';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function ExerciseDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTheme();
  const exercise = getExercise(slug);
  const [best, setBest] = useState<SessionRecord | null>(null);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goal, setGoal] = useState<{ type: 'reps' | 'hold'; values: number[] } | undefined>(undefined);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (s: string) => hasAllAccess || FREE_EXERCISES.includes(s);
  const goalPresets = useWorkouts((s) => s.goalPresets);
  const addGoalPreset = useWorkouts((s) => s.addGoalPreset);

  useEffect(() => {
    if (!exercise) return;
    listSessions()
      .then((rows) => setBest(bestSessionFor(exercise.id, rows)))
      .catch(() => {});
  }, [exercise]);

  if (!exercise) {
    return (
      <Screen>
        <Text>Exercise not found.</Text>
      </Screen>
    );
  }

  if (!isExerciseUnlocked(slug)) {
    return (
      <Screen>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg }}>
          <LockBadge size="lg" />
          <Text variant="label" tone="muted" style={{ letterSpacing: 2 }}>Locked</Text>
          <Text variant="heading" style={{ textAlign: 'center', marginTop: -Spacing.sm }}>{exercise.name}</Text>
          <Text tone="secondary" style={{ textAlign: 'center' }}>Unlock this exercise or get All Access.</Text>
          <Pressable style={[styles.lockedBuyBtn, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Text variant="heading">{exercise.name}</Text>
            <Text variant="heading" tone="accent">$1/mo</Text>
          </Pressable>
          <Pressable style={[styles.lockedBuyBtn, { backgroundColor: Feedback.good, borderColor: Feedback.good }]}>
            <Text variant="heading" style={{ color: '#000' }}>All Access</Text>
            <Text variant="heading" style={{ color: '#000' }}>$5/mo</Text>
          </Pressable>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.xs }}>Subscriptions aren&apos;t live yet — check back soon.</Text>
        </View>
      </Screen>
    );
  }

  const next = getNextProgression(exercise);
  const bestMetric = best ? (best.reps > 0 ? `${best.reps} reps` : `${best.holdSeconds}s hold`) : null;
  const improvements = best?.cues.slice(0, 3) ?? [];

  const pickVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access in Settings to pick a video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    router.push({ pathname: '/workout/analyze', params: { slug: exercise.slug, uri: result.assets[0].uri } });
  };

  const onAnalyzeVideo = () => {
    Alert.alert(
      'Filming angle matters',
      `${exercise.setup ?? 'Film so your whole body is in frame.'}\n\nIf the video doesn't match this angle, tracking can glitch or miss reps — the same way it would live.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose video', onPress: pickVideo },
      ],
    );
  };

  const startTracking = () => {
    router.push({
      pathname: '/workout/active',
      params: goal
        ? { slug: exercise.slug, goalType: goal.type, goalValues: goal.values.join(',') }
        : { slug: exercise.slug },
    });
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerRow}>
        <BackButton />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="muted">
            {exercise.category} · {exercise.family} · {exercise.mode === 'hold' ? 'Hold' : 'Reps'}
          </Text>
          <Text variant="title">{exercise.name}</Text>
        </View>
      </View>
      <Text variant="body" tone="secondary" style={{ marginTop: Spacing.xs }}>
        {exercise.summary}
      </Text>

      {exercise.setup ? (
        <View style={[styles.setup, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}>
          <Ionicons name="camera-outline" size={18} color={t.accent.color} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" tone="muted">
              Camera setup
            </Text>
            <Text variant="caption" tone="secondary">
              {exercise.setup}
            </Text>
          </View>
        </View>
      ) : null}

      {exercise.tracked ? (
        <>
          <PrimaryButton
            label="Train with camera"
            icon={<Ionicons name="videocam" size={20} color={t.surface.base} />}
            style={{ marginTop: Spacing.md }}
            onPress={startTracking}
          />
          <Pressable
            onPress={onAnalyzeVideo}
            style={({ pressed }) => [
              styles.analyzeBtn,
              { borderColor: t.ink.hairline, backgroundColor: t.surface.raised, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="film-outline" size={18} color={t.ink.secondary} />
            <Text variant="body" tone="secondary">Analyze a video from your phone</Text>
          </Pressable>
          {/* Most people just want to train — this stays a small, easy-to-ignore
              row instead of a question that blocks "Train with camera". */}
          <Pressable onPress={() => setGoalModalOpen(true)} style={styles.goalRow} hitSlop={4}>
            <Ionicons name="flag-outline" size={14} color={t.ink.muted} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {goal ? `Goal: ${goal.values.map((v) => `${v}${goal.type === 'hold' ? 's' : ''}`).join(', ')}` : 'Add checkpoints (optional)'}
            </Text>
            {goal ? (
              <Pressable hitSlop={8} onPress={() => setGoal(undefined)}>
                <Ionicons name="close-circle" size={15} color={t.ink.muted} />
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={14} color={t.ink.muted} />
            )}
          </Pressable>
        </>
      ) : (
        <View style={[styles.soon, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}>
          <Ionicons name="time-outline" size={18} color={t.ink.secondary} />
          <Text tone="secondary" variant="caption" style={{ flex: 1 }}>
            Live camera coaching for this move is coming soon — learn the form below.
          </Text>
        </View>
      )}

      {/* Your best run */}
      {best && bestMetric ? (
        <Pressable
          onPress={() => router.push({ pathname: '/workout/review/[id]', params: { id: best.id } })}
          style={({ pressed }) => [
            styles.bestCard,
            { backgroundColor: t.surface.raised, borderColor: t.accent.color, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={styles.bestIcon}>
            <Ionicons name="play" size={18} color="#000000" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label" tone="muted">
              Your best run
            </Text>
            <Text variant="heading">{bestMetric}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={t.ink.muted} />
        </Pressable>
      ) : null}

      <Section title="How to">
        {exercise.howTo.map((step, i) => (
          <View key={i} style={styles.step}>
            <View style={[styles.num, { borderColor: t.accent.color }]}>
              <Text variant="caption" tone="accent">
                {i + 1}
              </Text>
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              {step}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="Coach's tips">
        {exercise.cues.map((cue, i) => (
          <View key={i} style={styles.bullet}>
            <Ionicons name="checkmark-circle" size={18} color={t.accent.color} />
            <Text variant="body" tone="secondary" style={{ flex: 1 }}>
              {cue}
            </Text>
          </View>
        ))}
      </Section>

      {improvements.length > 0 ? (
        <Section title="What to work on">
          {improvements.map((c) => (
            <View key={c.ruleId} style={styles.bullet}>
              <Ionicons name="alert-circle" size={18} color={Feedback.warn} />
              <Text variant="body" tone="secondary" style={{ flex: 1 }}>
                {c.cue} — seen in your last best set.
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      {next ? (
        <Section title="Next progression">
          <Pressable
            onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: next.slug } })}
            style={({ pressed }) => [
              styles.nextCard,
              { backgroundColor: t.surface.raised, borderColor: t.ink.hairline, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="trending-up" size={20} color={t.accent.color} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{next.name}</Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {next.summary}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.ink.muted} />
          </Pressable>
        </Section>
      ) : null}

      <GoalPickerSheet
        visible={goalModalOpen}
        title={`${exercise.name} goal`}
        subtitle={
          exercise.mode === 'hold'
            ? 'Seconds to hold — pick one or several checkpoints, optional'
            : 'Reps to complete — pick one or several checkpoints, optional'
        }
        presets={goalPresets[exercise.slug] ?? []}
        unit={exercise.mode === 'hold' ? 's' : ''}
        initialValues={goal?.values}
        onConfirm={(values) => {
          values.forEach((v) => addGoalPreset(exercise.slug, v));
          setGoal({ type: exercise.mode === 'hold' ? 'hold' : 'reps', values });
          setGoalModalOpen(false);
        }}
        onClose={() => setGoalModalOpen(false)}
        skipLabel={goal ? 'Clear goal' : undefined}
        onSkip={goal ? () => { setGoal(undefined); setGoalModalOpen(false); } : undefined}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
      <Text variant="heading">{title}</Text>
      <View style={{ gap: Spacing.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  setup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  bestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  bestIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  num: { width: 26, height: 26, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  lockedBuyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
});
