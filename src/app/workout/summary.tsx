import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Confetti } from '@/components/Confetti';
import { ListGroup, ListRow } from '@/components/ListGroup';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useWorkoutRunStore } from '@/store/workoutRun';
import { Feedback, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function WorkoutSummaryScreen() {
  const t = useTheme();
  const finished = useWorkoutRunStore((s) => s.finished);
  const clear = useWorkoutRunStore((s) => s.clear);
  const [showConfetti, setShowConfetti] = useState(false);

  // Consumed exactly once — clear on the way out so a stray back-nav here
  // later doesn't show a stale recap.
  useEffect(() => () => clear(), [clear]);

  const anyNewRecord =
    finished?.steps.some((step) => {
      const achieved = step.goal.type === 'hold' ? step.summary.holdSeconds : step.summary.reps;
      return step.previousBest != null && achieved > step.previousBest;
    }) ?? false;

  useEffect(() => {
    if (anyNewRecord) setShowConfetti(true);
  }, [anyNewRecord]);

  if (!finished) {
    return (
      <Screen>
        <Text style={{ marginTop: Spacing.lg, textAlign: 'center' }}>Nothing to show.</Text>
      </Screen>
    );
  }

  const done = () => router.replace('/(tabs)');

  return (
    <>
      <Screen scroll>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xl }}>
          <Ionicons name="checkmark-circle" size={44} color={Feedback.good} />
          <Text variant="title">Workout complete</Text>
          <Text tone="secondary">{finished.workoutName}</Text>
        </View>

        <View style={{ marginTop: Spacing.xl }}>
          <ListGroup>
            {finished.steps.map((step, i) => {
              const isHold = step.goal.type === 'hold';
              const achievedValue = isHold ? step.summary.holdSeconds : step.summary.reps;
              const achieved = isHold ? `${achievedValue}s` : `${achievedValue} reps`;
              const sortedGoals = [...step.goal.values].sort((a, b) => a - b);
              const hit = sortedGoals.length > 0 && achievedValue >= sortedGoals[sortedGoals.length - 1];
              const goalsLabel = sortedGoals
                .map((v) => `${v}${isHold ? 's' : ''}${achievedValue >= v ? ' ✓' : ''}`)
                .join(', ');
              const isNewRecord = step.previousBest != null && achievedValue > step.previousBest;
              return (
                <ListRow
                  key={i}
                  title={step.exerciseName}
                  subtitle={`${achieved} · goal${sortedGoals.length > 1 ? 's' : ''} ${goalsLabel}`}
                  right={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isNewRecord ? <Ionicons name="trophy" size={17} color={Feedback.good} /> : null}
                      <Ionicons
                        name={hit ? 'checkmark-circle' : 'remove-circle-outline'}
                        size={20}
                        color={hit ? Feedback.good : t.ink.muted}
                      />
                    </View>
                  }
                />
              );
            })}
          </ListGroup>
        </View>

        <PrimaryButton label="Done" onPress={done} style={{ marginTop: Spacing.xl }} />
      </Screen>
      {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
    </>
  );
}
