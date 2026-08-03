import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { ExerciseTracker, type ExerciseTrackerResult } from '@/components/ExerciseTracker';
import { ExerciseSetupTip } from '@/components/ExerciseSetupTip';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { makeId } from '@/lib/format';
import { scoreSession } from '@/engine/sessionEngine';
import { useSessionStore } from '@/store/session';
import { useSettings } from '@/store/settings';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useChallengeStore } from '@/store/challenge';
import type { ExerciseGoal } from '@/store/workouts';
import { listSessionsForExercise } from '@/storage/db';

export default function ActiveWorkoutScreen() {
  const { slug, goalType, goalValues, challengeId, challengeTarget, challengeMode, challengeMinimum, challengeMinimumLabel } = useLocalSearchParams<{
    slug: string;
    goalType?: string;
    goalValues?: string;
    challengeId?: string;
    challengeTarget?: string;
    challengeMode?: string;
    challengeMinimum?: string;
    challengeMinimumLabel?: string;
  }>();
  const exercise = getExercise(slug);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const setFinished = useSessionStore((s) => s.setFinished);
  const dismissedTips = useSettings((s) => s.dismissedSetupTips);
  const dismissSetupTip = useSettings((s) => s.dismissSetupTip);
  const saveChallenge = useChallengeStore((s) => s.saveResult);
  const navigatedRef = useRef(false);
  const [showTip, setShowTip] = useState(true);

  const parsedValues = goalValues
    ? goalValues.split(',').map(Number).filter((n) => !Number.isNaN(n) && n > 0)
    : [];
  const goal: ExerciseGoal | undefined =
    (goalType === 'reps' || goalType === 'hold') && parsedValues.length > 0
      ? { type: goalType, values: parsedValues }
      : undefined;
  const challenge = useMemo(
    () => challengeId && challengeMode && challengeMinimum
      ? { mode: challengeMode, minimum: Number(challengeMinimum), minimumLabel: challengeMinimumLabel ?? 'reps' }
      : undefined,
    [challengeId, challengeMode, challengeMinimum, challengeMinimumLabel],
  );

  useEffect(() => {
    if (slug && !hasAllAccess && !FREE_EXERCISES.includes(slug)) {
      router.replace('/(tabs)');
    }
  }, [slug, hasAllAccess]);

  useEffect(() => {
    if (exercise && dismissedTips[exercise.slug]) setShowTip(false);
  }, [exercise, dismissedTips]);

  const handleTipContinue = useCallback((dontShowAgain: boolean) => {
    if (dontShowAgain && exercise) dismissSetupTip(exercise.slug);
    setShowTip(false);
  }, [exercise, dismissSetupTip]);

  const onPrimaryAction = useCallback(
    async (result: ExerciseTrackerResult) => {
      if (navigatedRef.current || !exercise) return;
      navigatedRef.current = true;
      try {
        const id = makeId();
        const createdAt = Date.now();
        const priorBest = bestSessionFor(exercise.id, await listSessionsForExercise(exercise.id).catch(() => []));
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
        const challengeValue = exercise.mode === 'hold' ? result.summary.holdSeconds : result.summary.totalReps;
        const challengeMet = !challenge || (challengeMode === 'max-time'
          ? result.summary.durationMs >= challenge.minimum * 1000
          : challengeValue >= challenge.minimum);
        if (challengeId && challenge && challengeMet) {
          saveChallenge({
            date: new Date().toISOString().slice(0, 10),
            challengeId,
            exerciseSlug: slug,
            target: challengeTarget ? Number(challengeTarget) : 0,
            score: scoreSession(result.summary),
            bestReps: result.summary.reps,
            totalReps: result.summary.totalReps,
            durationSeconds: Math.floor(result.summary.durationMs / 1000),
            bestHoldSeconds: result.summary.holdSeconds,
          });
        }
        // Nothing is written to history or uploaded yet — review/[id].tsx
        // does that only when the user taps "Save workout".
        router.replace({ pathname: '/workout/review/[id]', params: { id } });
      } catch {
        Alert.alert("Couldn't open review", 'Something went wrong wrapping up this set.');
        router.replace('/(tabs)');
      }
    },
    [exercise, setFinished, challengeId, challengeMode, challengeTarget, challenge, slug, saveChallenge],
  );

  if (!exercise) {
    return (
      <Screen>
        <Text>Exercise not found.</Text>
      </Screen>
    );
  }

  if (showTip && !dismissedTips[exercise.slug]) {
    return <ExerciseSetupTip exercise={exercise} onContinue={handleTipContinue} />;
  }

  return <ExerciseTracker exercise={exercise} goal={goal} challenge={challenge} primaryActionLabel="Stop" primaryActionIcon="stop" onPrimaryAction={onPrimaryAction} />;
}
