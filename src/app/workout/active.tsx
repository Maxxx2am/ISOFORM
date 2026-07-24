import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { ExerciseTracker, type ExerciseTrackerResult } from '@/components/ExerciseTracker';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { makeId } from '@/lib/format';
import { useSessionStore } from '@/store/session';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import type { ExerciseGoal } from '@/store/workouts';
import { listSessions, saveSession } from '@/storage/db';

export default function ActiveWorkoutScreen() {
  const { slug, goalType, goalValues } = useLocalSearchParams<{ slug: string; goalType?: string; goalValues?: string }>();
  const exercise = getExercise(slug);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const setFinished = useSessionStore((s) => s.setFinished);
  const navigatedRef = useRef(false);

  const parsedValues = goalValues
    ? goalValues.split(',').map(Number).filter((n) => !Number.isNaN(n) && n > 0)
    : [];
  const goal: ExerciseGoal | undefined =
    (goalType === 'reps' || goalType === 'hold') && parsedValues.length > 0
      ? { type: goalType, values: parsedValues }
      : undefined;

  useEffect(() => {
    if (slug && !hasAllAccess && !FREE_EXERCISES.includes(slug)) {
      router.replace('/(tabs)');
    }
  }, [slug, hasAllAccess]);

  const onPrimaryAction = useCallback(
    async (result: ExerciseTrackerResult) => {
      if (navigatedRef.current || !exercise) return;
      navigatedRef.current = true;
      try {
        const id = makeId();
        const createdAt = Date.now();
        const priorBest = bestSessionFor(exercise.id, await listSessions().catch(() => []));
        const previousBest = priorBest ? (priorBest.reps > 0 ? priorBest.reps : priorBest.holdSeconds) : null;
        setFinished({
          id,
          exerciseName: exercise.name,
          createdAt,
          summary: result.summary,
          timeline: result.timeline,
          videoUri: result.videoUri,
          videoAspect: result.videoAspect,
          previousBest,
        });
        // Awaited (not fire-and-forget): a quick second attempt's previousBest
        // lookup must never race ahead of this write finishing.
        await saveSession(id, exercise.name, createdAt, result.summary, result.videoUri, result.timeline, result.videoAspect).catch(() => {});
        router.replace({ pathname: '/workout/review/[id]', params: { id } });
      } catch {
        router.replace('/(tabs)');
      }
    },
    [exercise, setFinished],
  );

  if (!exercise) {
    return (
      <Screen>
        <Text>Exercise not found.</Text>
      </Screen>
    );
  }

  return <ExerciseTracker exercise={exercise} goal={goal} primaryActionLabel="Stop" primaryActionIcon="stop" onPrimaryAction={onPrimaryAction} />;
}
