import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { GoalPickerSheet } from '@/components/GoalPicker';
import { ListGroup, ListRow } from '@/components/ListGroup';
import { LockBadge } from '@/components/LockBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { useActiveExercises } from '@/exercises/registry';
import type { Exercise } from '@/exercises/types';
import { searchExercises } from '@/lib/search';
import { makeId } from '@/lib/format';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useWorkoutDraft } from '@/store/workoutDraft';
import { useWorkouts, type ExerciseGoal, type WorkoutStep } from '@/store/workouts';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function defaultGoal(ex: Exercise): ExerciseGoal {
  return ex.mode === 'hold' ? { type: 'hold', values: [20] } : { type: 'reps', values: [10] };
}

export default function WorkoutBuilderScreen() {
  const t = useTheme();
  const { id, mode } = useLocalSearchParams<{ id?: string; mode?: string }>();
  // "Start workout" from the Train tab: pick exercises and go, nothing saved
  // as a template — reuses this same picker/goal UI instead of a parallel one.
  const isStart = mode === 'start' && !id;
  const existing = useWorkouts((s) => s.workouts.find((w) => w.id === id));
  const addWorkout = useWorkouts((s) => s.addWorkout);
  const updateWorkout = useWorkouts((s) => s.updateWorkout);
  const goalPresets = useWorkouts((s) => s.goalPresets);
  const addGoalPreset = useWorkouts((s) => s.addGoalPreset);
  const setDraft = useWorkoutDraft((s) => s.setDraft);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);

  const [name, setName] = useState(existing?.name ?? '');
  const [steps, setSteps] = useState<WorkoutStep[]>(existing?.steps ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [goalStepId, setGoalStepId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const exercises = useActiveExercises();
  const results = useMemo(
    () => searchExercises(query, exercises.filter((e) => e.tracked)),
    [query, exercises],
  );

  const addStep = (ex: Exercise) => {
    setSteps((s) => [...s, { id: makeId(), exerciseSlug: ex.slug, goal: defaultGoal(ex) }]);
    setPickerOpen(false);
    setQuery('');
  };

  const removeStep = (stepId: string) => setSteps((s) => s.filter((st) => st.id !== stepId));

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((s) => {
      const next = [...s];
      const j = index + dir;
      if (j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const setStepGoalValues = (stepId: string, values: number[]) => {
    setSteps((s) => s.map((st) => (st.id === stepId ? { ...st, goal: { ...st.goal, values } } : st)));
    const step = steps.find((st) => st.id === stepId);
    if (step) values.forEach((v) => addGoalPreset(step.exerciseSlug, v));
  };

  const save = () => {
    const finalName = name.trim() || 'Workout';
    if (existing) {
      updateWorkout(existing.id, { name: finalName, steps });
    } else {
      addWorkout({ id: makeId(), name: finalName, steps, createdAt: Date.now() });
    }
    router.back();
  };

  const start = () => {
    setDraft({ name: name.trim() || 'Workout', steps });
    router.replace({ pathname: '/workout/run', params: { id: '__draft__' } });
  };

  const goalStep = steps.find((s) => s.id === goalStepId) ?? null;
  const goalExercise = goalStep ? getExercise(goalStep.exerciseSlug) : null;

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <BackButton />
        <Text variant="title">{isStart ? 'Start workout' : existing ? 'Edit template' : 'New template'}</Text>
      </View>

      {isStart ? null : (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Template name"
          placeholderTextColor={t.ink.muted}
          style={[styles.nameInput, { color: t.ink.primary, borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
        />
      )}

      <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
        {steps.length === 0 ? (
          <Text tone="muted" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            No exercises yet — add your first below.
          </Text>
        ) : (
          <ListGroup>
            {steps.map((step, i) => {
              const ex = getExercise(step.exerciseSlug);
              if (!ex) return null;
              return (
                <ListRow
                  key={step.id}
                  title={ex.name}
                  subtitle={`Goal: ${step.goal.values.map((v) => `${v}${step.goal.type === 'hold' ? 's' : ''}`).join(', ')}${step.goal.type === 'reps' ? ' reps' : ''}`}
                  onPress={() => setGoalStepId(step.id)}
                  right={
                    <View style={styles.rowActions}>
                      <Pressable hitSlop={8} onPress={() => moveStep(i, -1)} disabled={i === 0}>
                        <Ionicons name="chevron-up" size={18} color={i === 0 ? t.ink.hairline : t.ink.muted} />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
                        <Ionicons name="chevron-down" size={18} color={i === steps.length - 1 ? t.ink.hairline : t.ink.muted} />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => removeStep(step.id)}>
                        <Ionicons name="close" size={18} color={t.ink.muted} />
                      </Pressable>
                    </View>
                  }
                />
              );
            })}
          </ListGroup>
        )}

        <Pressable
          onPress={() => setPickerOpen(true)}
          style={[styles.addExercise, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
        >
          <Ionicons name="add-circle-outline" size={20} color={t.accent.color} />
          <Text variant="body" tone="accent">
            Add exercise
          </Text>
        </Pressable>
      </View>

      <PrimaryButton
        label={isStart ? 'Start' : existing ? 'Save changes' : 'Save template'}
        variant={isStart ? 'hero' : 'primary'}
        icon={isStart ? <Ionicons name="arrow-forward" size={26} color={t.accent.onColor} /> : undefined}
        disabled={steps.length === 0}
        onPress={isStart ? start : save}
        style={{ marginTop: Spacing.xl }}
      />

      {/* Exercise picker. RN's <Modal> presents in its own separate native
          root on iOS — the app's own SafeAreaProvider (in the root layout)
          doesn't reliably reach insets computed inside it, which is what let
          the title render up under the notch/Dynamic Island. A SafeAreaProvider
          scoped to just this modal fixes that. */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaProvider>
          <Screen scroll>
            <View style={styles.headerRow}>
              <Pressable onPress={() => setPickerOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={t.ink.primary} />
              </Pressable>
              <Text variant="title">Add exercise</Text>
            </View>
            <View style={[styles.search, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
              <Ionicons name="search" size={17} color={t.ink.muted} />
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
            <View style={{ marginTop: Spacing.md }}>
              <ListGroup>
                {results.map((ex) => {
                  const unlocked = isExerciseUnlocked(ex.slug);
                  return (
                    <ListRow
                      key={ex.id}
                      title={ex.name}
                      subtitle={ex.summary}
                      dimmed={!unlocked}
                      onPress={unlocked ? () => addStep(ex) : undefined}
                      right={unlocked ? undefined : <LockBadge />}
                    />
                  );
                })}
              </ListGroup>
            </View>
          </Screen>
        </SafeAreaProvider>
      </Modal>

      {/* Goal editor */}
      <GoalPickerSheet
        visible={goalStep != null}
        title={`${goalExercise?.name ?? ''} goal`}
        subtitle={goalStep?.goal.type === 'hold' ? 'Seconds to hold — pick one or several checkpoints' : 'Reps to complete — pick one or several checkpoints'}
        presets={goalStep ? goalPresets[goalStep.exerciseSlug] ?? [] : []}
        unit={goalStep?.goal.type === 'hold' ? 's' : ''}
        initialValues={goalStep?.goal.values}
        onConfirm={(values) => {
          if (goalStep) setStepGoalValues(goalStep.id, values);
          setGoalStepId(null);
        }}
        onClose={() => setGoalStepId(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  nameInput: {
    marginTop: Spacing.lg,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    fontWeight: '600',
  },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  addExercise: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '500', paddingVertical: 0 },
});
