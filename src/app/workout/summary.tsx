import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { Confetti } from '@/components/Confetti';
import { ListGroup, ListRow } from '@/components/ListGroup';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { makeId } from '@/lib/format';

import { useWorkoutRunStore } from '@/store/workoutRun';
import { useWorkouts } from '@/store/workouts';
import { saveSession } from '@/storage/db';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function WorkoutSummaryScreen() {
  const t = useTheme();
  const finished = useWorkoutRunStore((s) => s.finished);
  const clear = useWorkoutRunStore((s) => s.clear);
  const addWorkout = useWorkouts((s) => s.addWorkout);
  const [showConfetti, setShowConfetti] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [namingTemplate, setNamingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaved, setTemplateSaved] = useState(false);
  // Which step ids already made it into the DB — checked before each save
  // attempt so a retry after a partial failure only retries the steps that
  // actually failed. `saveSession` is a plain INSERT (no upsert): re-running
  // it for a step that already succeeded would hit the sessions table's
  // PRIMARY KEY constraint and fail forever, permanently blocking the save.
  const savedStepIdsRef = useRef<Set<string>>(new Set());

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

  const saveWorkout = async () => {
    if (saving || !finished) return;
    setSaving(true);
    try {
      for (const step of finished.steps) {
        if (savedStepIdsRef.current.has(step.id)) continue;
        await saveSession(step.id, step.exerciseName, step.createdAt, step.summary, step.videoUri, step.timeline, step.videoAspect);
        savedStepIdsRef.current.add(step.id);
      }
      setSaved(true);
    } catch {
      Alert.alert("Couldn't save", 'Something went wrong saving this workout. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmSaveAsTemplate = () => {
    const name = templateName.trim();
    if (!name || !finished) return;
    addWorkout({ id: makeId(), name, steps: finished.sourceSteps, createdAt: Date.now() });
    setTemplateSaved(true);
    setNamingTemplate(false);
  };

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

        <PrimaryButton
          label={saved ? 'Done' : saving ? 'Saving…' : 'Save workout'}
          disabled={saving}
          onPress={saved ? done : saveWorkout}
          style={{ marginTop: Spacing.xl }}
        />

        {finished.isDraft ? (
          <View style={{ marginTop: Spacing.md }}>
            {templateSaved ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'center' }}>
                <Ionicons name="checkmark-circle" size={16} color={Feedback.good} />
                <Text variant="caption" tone="secondary">Saved as a template</Text>
              </View>
            ) : namingTemplate ? (
              <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                <TextInput
                  value={templateName}
                  onChangeText={setTemplateName}
                  placeholder="Template name"
                  placeholderTextColor={t.ink.muted}
                  autoFocus
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: Radius.md,
                    borderWidth: 1,
                    borderColor: t.ink.hairline,
                    backgroundColor: t.surface.raised,
                    paddingHorizontal: Spacing.md,
                    color: t.ink.primary,
                    fontSize: 16,
                  }}
                />
                <PrimaryButton label="Save" onPress={confirmSaveAsTemplate} style={{ width: 90 }} />
              </View>
            ) : (
              <PrimaryButton
                label="Save as template"
                variant="ghost"
                onPress={() => setNamingTemplate(true)}
              />
            )}
          </View>
        ) : null}
      </Screen>
      {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
    </>
  );
}
