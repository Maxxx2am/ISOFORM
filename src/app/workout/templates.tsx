import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';

import { BackButton } from '@/components/BackButton';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { BUILTIN_TEMPLATES } from '@/exercises/builtinTemplates';
import { getExercise } from '@/exercises/data';
import { useActiveExercises } from '@/exercises/registry';
import { generateQuickWorkout } from '@/lib/workoutGenerator';
import { useWorkoutDraft } from '@/store/workoutDraft';
import { useWorkouts, type SavedWorkout, type WorkoutStep } from '@/store/workouts';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function subtitleFor(steps: WorkoutStep[]) {
  const names = steps.map((s) => getExercise(s.exerciseSlug)?.name).filter(Boolean);
  return `${steps.length} exercise${steps.length === 1 ? '' : 's'} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
}

export default function ChooseTemplateScreen() {
  const t = useTheme();
  const exercises = useActiveExercises();
  const workouts = useWorkouts((s) => s.workouts);
  const deleteWorkout = useWorkouts((s) => s.deleteWorkout);
  const setDraft = useWorkoutDraft((s) => s.setDraft);
  const [quickOpen, setQuickOpen] = useState(false);

  const startBuiltin = (name: string, steps: WorkoutStep[]) => {
    setDraft({ name, steps });
    router.push({ pathname: '/workout/run', params: { id: '__draft__' } });
  };

  const startQuick = (timeMin: number) => {
    const generated = generateQuickWorkout(timeMin, exercises);
    const steps: WorkoutStep[] = generated.map((s) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      exerciseSlug: s.exerciseSlug,
      goal: s.goal as WorkoutStep['goal'],
    }));
    setDraft({ name: `${timeMin}-min workout`, steps });
    router.push({ pathname: '/workout/run', params: { id: '__draft__' } });
  };

  const onDelete = (w: SavedWorkout) => {
    Alert.alert('Delete template?', `"${w.name}" will be removed. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWorkout(w.id) },
    ]);
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <BackButton />
        <Text variant="title">Choose template</Text>
      </View>

      <Pressable
        onPress={() => router.push('/workout/builder')}
        style={[styles.createRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
      >
        <Ionicons name="add-circle-outline" size={20} color={t.accent.color} />
        <Text variant="body" tone="accent">
          Create your own
        </Text>
      </Pressable>

      {workouts.length > 0 ? (
        <View style={{ marginTop: Spacing.lg }}>
          <SectionLabel>Your templates</SectionLabel>
          <ListGroup>
            {workouts.map((w) => (
              <ListRow
                key={w.id}
                title={w.name}
                subtitle={subtitleFor(w.steps)}
                chevron
                onPress={() => router.push({ pathname: '/workout/run', params: { id: w.id } })}
                right={
                  <Pressable hitSlop={10} onPress={() => onDelete(w)} style={{ marginRight: Spacing.xs }}>
                    <Ionicons name="trash-outline" size={18} color={t.ink.muted} />
                  </Pressable>
                }
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Ready-made</SectionLabel>
        <ListGroup>
          {BUILTIN_TEMPLATES.map((tpl) => (
            <ListRow
              key={tpl.name}
              title={tpl.name}
              subtitle={subtitleFor(tpl.steps)}
              chevron
              onPress={() => startBuiltin(tpl.name, tpl.steps)}
            />
          ))}
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Quick generate</SectionLabel>
        <Pressable
          onPress={() => setQuickOpen((v) => !v)}
          style={({ pressed }) => [
            styles.quickRow,
            { backgroundColor: pressed ? t.surface.pressed : t.surface.raised, borderColor: t.ink.hairline },
          ]}
        >
          <Ionicons name="flash-outline" size={19} color={t.accent.color} />
          <View style={{ flex: 1 }}>
            <Text variant="body">Generate a circuit</Text>
            <Text variant="caption" tone="secondary">Auto-balanced by time</Text>
          </View>
          <Ionicons name={quickOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.ink.muted} />
        </Pressable>
        {quickOpen ? (
          <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
            {[5, 10, 15, 20].map((min) => (
              <Pressable
                key={min}
                onPress={() => { setQuickOpen(false); startQuick(min); }}
                style={({ pressed }) => [
                  styles.quickBtn,
                  { backgroundColor: pressed ? t.surface.pressed : t.surface.sunken, borderColor: t.ink.hairline },
                ]}
              >
                <Text variant="heading">{min}m</Text>
                <Text variant="caption" tone="muted">{min <= 5 ? '2 ex' : min <= 10 ? '3 ex' : min <= 15 ? '4 ex' : '5 ex'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
});
