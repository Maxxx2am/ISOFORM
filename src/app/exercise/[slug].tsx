import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { BackButton } from '@/components/BackButton';
import { GoalPickerSheet } from '@/components/GoalPicker';
import { ListGroup, ListRow } from '@/components/ListGroup';
import { LockBadge } from '@/components/LockBadge';
import { MuscleDiagrams } from '@/components/MuscleDiagrams';
import { PlanRows, StreakHook } from '@/components/PaywallOffer';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise, getNextProgression } from '@/exercises/data';
import { useActiveExercises } from '@/exercises/registry';
import { bestSessionFor } from '@/lib/insights';
import { useFavorites } from '@/store/favorites';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useWorkouts } from '@/store/workouts';
import { listSessionsForExercise, type SessionRecord } from '@/storage/db';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function ExerciseDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTheme();
  const exercise = getExercise(slug);
  const [best, setBest] = useState<SessionRecord | null>(null);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [showAllTips, setShowAllTips] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [goal, setGoal] = useState<{ type: 'reps' | 'hold'; values: number[] } | undefined>(undefined);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (s: string) => hasAllAccess || FREE_EXERCISES.includes(s);
  const exercises = useActiveExercises();
  const favorites = useFavorites();
  const isFav = favorites.isFavorite(slug);
  const goalPresets = useWorkouts((s) => s.goalPresets);
  const addGoalPreset = useWorkouts((s) => s.addGoalPreset);

  useEffect(() => {
    if (!exercise) return;
    listSessionsForExercise(exercise.id)
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
          <StreakHook active />
          <PlanRows exerciseName={exercise.name} lockedCount={Math.max(0, exercises.length - FREE_EXERCISES.length)} />
        </View>
      </Screen>
    );
  }

  const next = getNextProgression(exercise);
  const bestMetric = best ? (best.reps > 0 ? `${best.reps} reps` : `${best.holdSeconds}s hold`) : null;
  const improvements = best?.cues.slice(0, 3) ?? [];

  const startTracking = () => {
    router.push({
      pathname: '/workout/active',
      params: goal
        ? { slug: exercise.slug, goalType: goal.type, goalValues: goal.values.join(',') }
        : { slug: exercise.slug },
    });
  };

  const importFromVideo = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!req.granted) {
        Alert.alert('Permission needed', 'Allow access to your photo library to import videos.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    router.push({
      pathname: '/workout/import',
      params: { slug: exercise.slug, videoUri: result.assets[0].uri },
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
        <Pressable
          hitSlop={8}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            favorites.toggle(slug);
          }}
          style={({ pressed }) => [
            styles.favBtn,
            { backgroundColor: isFav ? `${t.accent.color}18` : t.surface.sunken },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            name={isFav ? 'star' : 'star-outline'}
            size={20}
            color={isFav ? t.accent.color : t.ink.secondary}
          />
        </Pressable>
      </View>
      <Text variant="body" tone="secondary" style={{ marginTop: Spacing.xs }}>
        {exercise.summary}
      </Text>

      {exercise.setup ? (
        // Pure info, not an action — dashed + no fill so it reads as a note,
        // not one more identical card competing with the buttons below it.
        <View style={[styles.hint, { borderColor: t.ink.hairline }]}>
          <Ionicons name="camera-outline" size={16} color={t.ink.muted} />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            {exercise.setup}
          </Text>
        </View>
      ) : null}

      {exercise.tracked ? (
        <>
          <PrimaryButton
            label="Train with camera"
            variant="hero"
            icon={<Ionicons name="videocam" size={24} color={t.accent.onColor} />}
            style={{ marginTop: Spacing.md }}
            onPress={startTracking}
          />
          {/* A plain ghost row, not a second bordered pill — "Train with
              camera" is the one real decision on this screen; the checkpoints
              row below it is a quiet, easy-to-ignore alternative, not a
              competing CTA. */}
          <Pressable onPress={() => setGoalModalOpen(true)} style={styles.ghostRow} hitSlop={4}>
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
          <PrimaryButton
            label="Import from video"
            variant="ghost"
            icon={<Ionicons name="cloud-upload-outline" size={20} color={t.ink.secondary} />}
            style={{ marginTop: Spacing.sm }}
            onPress={importFromVideo}
          />
        </>
      ) : (
        <View style={[styles.hint, { borderColor: t.ink.hairline }]}>
          <Ionicons name="time-outline" size={16} color={t.ink.muted} />
          <Text tone="secondary" variant="caption" style={{ flex: 1 }}>
            Live camera coaching for this move is coming soon — learn the form below.
          </Text>
        </View>
      )}

      {/* Your best run — the one genuine achievement moment on this screen.
          Tinted fill with a subtle radial gradient glow behind it to make it
          feel like a lit highlight, not just another bordered card. */}
      {best && bestMetric ? (
        <Pressable
          onPress={() => router.push({ pathname: '/workout/review/[id]', params: { id: best.id } })}
          style={({ pressed }) => [
            styles.bestCard,
            { backgroundColor: `${t.accent.color}12`, borderColor: `${t.accent.color}44`, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={styles.bestGlowWrap}>
            <Svg width={240} height={140} style={{ position: 'absolute' }}>
              <Defs>
                <RadialGradient id="bestGlow" cx="30%" cy="50%" r="60%">
                  <Stop offset="0%" stopColor={t.accent.color} stopOpacity={0.12} />
                  <Stop offset="100%" stopColor={t.accent.color} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={80} cy={70} r={120} fill="url(#bestGlow)" />
            </Svg>
          </View>
          <View style={[styles.bestIcon, { backgroundColor: t.accent.color }]}>
            <Ionicons name="play" size={18} color={t.accent.onColor} />
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

      {/* How-to/tips are above the muscle diagrams so the body map stays
          at the bottom of the page when the guide is open. */}
      <View style={{ marginTop: Spacing.lg }}>
        <ListGroup>
              <ListRow
                title="How to do it"
                subtitle={`${exercise.howTo.length} steps · ${exercise.cues.length} tips`}
                icon={<Ionicons name="book-outline" size={19} color={t.accent.color} />}
                right={<Ionicons name={guideOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.ink.muted} />}
                onPress={() => setGuideOpen((v) => !v)}
                chevron={false}
              />
            </ListGroup>
          </View>

          {guideOpen ? (
        <>
          <Section title="Steps">
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
            {(showAllTips ? exercise.cues : exercise.cues.slice(0, 4)).map((cue, i) => (
              <View key={i} style={styles.bullet}>
                <Ionicons name="checkmark-circle" size={18} color={t.accent.color} />
                <Text variant="body" tone="secondary" style={{ flex: 1 }}>
                  {cue}
                </Text>
              </View>
            ))}
            {!showAllTips && exercise.cues.length > 4 ? (
              <Pressable
                onPress={() => setShowAllTips(true)}
                style={({ pressed }) => [styles.showMoreRow, pressed && { backgroundColor: `${t.accent.color}10` }]}
                accessibilityRole="button"
              >
                <Text variant="body" tone="accent">
                  Show {exercise.cues.length - 4} more tip{exercise.cues.length - 4 === 1 ? '' : 's'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={t.accent.color} />
              </Pressable>
            ) : null}
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
        </>
      ) : null}

      {exercise.muscles.length > 0 ? (
        <View style={{ marginTop: 0, alignItems: 'center' }}>
          <MuscleDiagrams muscles={exercise.muscles} />
          <View style={{ flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', justifyContent: 'center', marginTop: Spacing.xs }}>
            {exercise.muscles.map((m) => (
              <View key={m} style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: `${t.accent.color}22` }}>
                <Text variant="caption" tone="accent">{m}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {next ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text variant="label" tone="muted" style={{ marginBottom: Spacing.sm, marginLeft: 4 }}>
            Next progression
          </Text>
          <ListGroup>
            <ListRow
              title={next.name}
              subtitle={next.summary}
              icon={<Ionicons name="trending-up" size={19} color={t.accent.color} />}
              onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: next.slug } })}
            />
          </ListGroup>
        </View>
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
  favBtn: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  // Dashed + no fill so a plain info note doesn't compete visually with the
  // real action cards/buttons around it (camera setup hint, "coming soon").
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  // No border/background at all — a quiet, easy-to-ignore alternative row
  // (add checkpoints), not a second CTA next to the hero button.
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  bestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bestGlowWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bestIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  num: { width: 26, height: 26, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  showMoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: Radius.md },
});
