import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { ExerciseTracker, type ExerciseTrackerResult } from '@/components/ExerciseTracker';
import { ExerciseSetupTip } from '@/components/ExerciseSetupTip';
import { LockBadge } from '@/components/LockBadge';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { makeId } from '@/lib/format';
import { listSessionsForExercise } from '@/storage/db';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useSettings } from '@/store/settings';
import { useWorkoutDraft } from '@/store/workoutDraft';
import { useWorkoutRunStore, type WorkoutRunStep } from '@/store/workoutRun';
import { useWorkouts, type SavedWorkout } from '@/store/workouts';
import { Radius, Spacing } from '@/theme/palette';

const DRAFT_ID = '__draft__';

export default function WorkoutRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const savedWorkout = useWorkouts((s) => s.workouts.find((w) => w.id === id));
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
  const dismissedTips = useSettings((s) => s.dismissedSetupTips);
  const dismissSetupTip = useSettings((s) => s.dismissSetupTip);

  const [stepIndex, setStepIndex] = useState(0);
  const [finishedSteps, setFinishedSteps] = useState<WorkoutRunStep[]>([]);
  const [showTip, setShowTip] = useState(true);
  const tipStepRef = useRef(0);

  useEffect(() => {
    if (stepIndex !== tipStepRef.current) {
      tipStepRef.current = stepIndex;
      setShowTip(true);
    }
  }, [stepIndex]);

  const currentExercise = workout?.steps[stepIndex] ? getExercise(workout.steps[stepIndex].exerciseSlug) : undefined;
  const tipDismissed = currentExercise ? dismissedTips[currentExercise.slug] : false;

  const handleTipContinue = useCallback((dontShowAgain: boolean) => {
    if (dontShowAgain && currentExercise) dismissSetupTip(currentExercise.slug);
    setShowTip(false);
  }, [currentExercise, dismissSetupTip]);

  const onStepFinish = useCallback(
    async (result: ExerciseTrackerResult) => {
      if (!workout) return;
      const step = workout.steps[stepIndex];
      const exercise = getExercise(step.exerciseSlug);
      if (!exercise) return;

      const priorBest = bestSessionFor(exercise.id, await listSessionsForExercise(exercise.id).catch(() => []));
      const previousBest = priorBest ? (priorBest.reps > 0 ? priorBest.reps : priorBest.holdSeconds) : null;

      const sessionId = makeId();
      const createdAt = Date.now();
      const nextFinished = [
        ...finishedSteps,
        {
          exerciseName: exercise.name,
          exerciseSlug: exercise.slug,
          summary: result.summary,
          goal: step.goal,
          previousBest,
          id: sessionId,
          createdAt,
          videoUri: result.videoUri,
          timeline: result.timeline,
          videoAspect: result.videoAspect,
        },
      ];
      if (stepIndex + 1 >= workout.steps.length) {
        setFinished({
          workoutName: workout.name,
          steps: nextFinished,
          isDraft: id === DRAFT_ID,
          sourceSteps: workout.steps,
        });
        router.replace('/workout/summary');
      } else {
        setFinishedSteps(nextFinished);
        setStepIndex(stepIndex + 1);
      }
    },
    [workout, stepIndex, finishedSteps, setFinished, id],
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

  if (showTip && !tipDismissed) {
    return <ExerciseSetupTip exercise={exercise} onContinue={handleTipContinue} />;
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
