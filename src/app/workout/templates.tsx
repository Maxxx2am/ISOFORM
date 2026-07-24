import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { BUILTIN_TEMPLATES } from '@/exercises/builtinTemplates';
import { getExercise } from '@/exercises/data';
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
  const workouts = useWorkouts((s) => s.workouts);
  const deleteWorkout = useWorkouts((s) => s.deleteWorkout);
  const setDraft = useWorkoutDraft((s) => s.setDraft);

  const startBuiltin = (name: string, steps: WorkoutStep[]) => {
    setDraft({ name, steps });
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
});
