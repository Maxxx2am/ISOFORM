import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { ExerciseTracker, type ExerciseTrackerResult } from '@/components/ExerciseTracker';
import { LockBadge } from '@/components/LockBadge';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { makeId } from '@/lib/format';
import { listSessions, saveSession } from '@/storage/db';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useWorkoutDraft } from '@/store/workoutDraft';
import { useWorkoutRunStore, type WorkoutRunStep } from '@/store/workoutRun';
import { useWorkouts, type SavedWorkout } from '@/store/workouts';
import { Radius, Spacing } from '@/theme/palette';

const DRAFT_ID = '__draft__';

export default function WorkoutRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const savedWorkout = useWorkouts((s) => s.workouts.find((w) => w.id === id));
  // Ad-hoc "Start workout" runs never get saved — captured ONCE on mount from
  // the in-memory draft store so the workout doesn't vanish mid-run if
  // something else touches the draft (e.g. starting a second one from
  // another tab), and cleared right away so it can't be accidentally re-run.
  const [draftWorkout] = useState<SavedWorkout | undefined>(() => {
    if (id !== DRAFT_ID) return undefined;
    const d = useWorkoutDraft.getState().draft;
    return d ? { id: DRAFT_ID, name: d.name, steps: d.steps, createdAt: 0 } : undefined;
  });
  useEffect(() => {
    if (id === DRAFT_ID) useWorkoutDraft.getState().clearDraft();
  }, [id]);
  const workout = savedWorkout ?? draftWorkout;
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);
  const setFinished = useWorkoutRunStore((s) => s.setFinished);

  const [stepIndex, setStepIndex] = useState(0);
  const [finishedSteps, setFinishedSteps] = useState<WorkoutRunStep[]>([]);

  const onStepFinish = useCallback(
    async (result: ExerciseTrackerResult) => {
      if (!workout) return;
      const step = workout.steps[stepIndex];
      const exercise = getExercise(step.exerciseSlug);
      if (!exercise) return;

      const priorBest = bestSessionFor(exercise.id, await listSessions().catch(() => []));
      const previousBest = priorBest ? (priorBest.reps > 0 ? priorBest.reps : priorBest.holdSeconds) : null;

      const sessionId = makeId();
      // Awaited — the NEXT step's previousBest lookup runs moments later and
      // must never race ahead of this write finishing.
      await saveSession(sessionId, exercise.name, Date.now(), result.summary, result.videoUri, result.timeline, result.videoAspect).catch(() => {});

      const nextFinished = [
        ...finishedSteps,
        { exerciseName: exercise.name, exerciseSlug: exercise.slug, summary: result.summary, goal: step.goal, previousBest },
      ];
      if (stepIndex + 1 >= workout.steps.length) {
        setFinished({ workoutName: workout.name, steps: nextFinished });
        router.replace('/workout/summary');
      } else {
        setFinishedSteps(nextFinished);
        setStepIndex(stepIndex + 1);
      }
    },
    [workout, stepIndex, finishedSteps, setFinished],
  );

  if (!workout) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md }}>
          <BackButton />
        </View>
        <Text style={{ marginTop: Spacing.lg, textAlign: 'center' }}>Workout not found.</Text>
      </Screen>
    );
  }

  const anyLocked = workout.steps.some((s) => !isExerciseUnlocked(s.exerciseSlug));
  if (anyLocked) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md }}>
          <BackButton />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg }}>
          <LockBadge size="lg" />
          <Text variant="heading" style={{ textAlign: 'center' }}>
            This workout has a locked exercise
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center' }}>
            Unlock every exercise in &quot;{workout.name}&quot; (or get All Access) to run it.
          </Text>
        </View>
      </Screen>
    );
  }

  const step = workout.steps[stepIndex];
  const exercise = getExercise(step.exerciseSlug);
  if (!exercise) {
    return (
      <Screen>
        <Text>Exercise not found.</Text>
      </Screen>
    );
  }

  const isLast = stepIndex + 1 >= workout.steps.length;

  return (
    <ExerciseTracker
      key={step.id}
      exercise={exercise}
      goal={step.goal}
      header={
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
            paddingHorizontal: Spacing.md,
            paddingVertical: 6,
            borderRadius: Radius.pill,
          }}
        >
          <Text variant="caption" style={{ color: '#FFFFFF', textAlign: 'center' }}>
            Step {stepIndex + 1} of {workout.steps.length} · {exercise.name}
          </Text>
        </View>
      }
      primaryActionLabel={isLast ? 'Finish workout' : 'Next exercise'}
      primaryActionIcon={isLast ? 'checkmark-done' : 'arrow-forward-circle'}
      onPrimaryAction={onStepFinish}
    />
  );
}
