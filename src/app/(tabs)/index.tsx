import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { LockBadge } from '@/components/LockBadge';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EXERCISES } from '@/exercises/data';
import type { Exercise, ExerciseCategory } from '@/exercises/types';
import { searchExercises } from '@/lib/search';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useUiStore } from '@/store/ui';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const SECTIONS: { key: ExerciseCategory; label: string }[] = [
  { key: 'lower', label: 'Lower body' },
  { key: 'upper', label: 'Upper body' },
  { key: 'core', label: 'Core' },
  { key: 'full', label: 'Full body' },
];

export default function TrainScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchExercises(query, EXERCISES), [query]);
  const searching = query.trim().length > 0;
  // Select the boolean directly (not the whole store) so this screen re-renders
  // the instant All Access flips in Settings — no app reload needed.
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);
  const [buyTarget, setBuyTarget] = useState<Exercise | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const setOverlayOpen = useUiStore((s) => s.setOverlayOpen);
  useEffect(() => {
    setOverlayOpen(buyTarget != null || addOpen);
    return () => setOverlayOpen(false);
  }, [buyTarget, addOpen, setOverlayOpen]);

  const open = (slug: string) => {
    if (isExerciseUnlocked(slug)) {
      router.push({ pathname: '/exercise/[slug]', params: { slug } });
    }
  };

  const row = (ex: Exercise) => {
    const unlocked = isExerciseUnlocked(ex.slug);
    return (
      <ListRow
        key={ex.id}
        title={ex.name}
        subtitle={ex.summary}
        onPress={() => (unlocked ? open(ex.slug) : setBuyTarget(ex))}
        right={
          unlocked ? (
            ex.tracked ? (
              <Ionicons name="videocam" size={15} color={t.accent.color} />
            ) : (
              <Text variant="label" tone="muted">
                Lv {ex.level}
              </Text>
            )
          ) : (
            <LockBadge />
          )
        }
        dimmed={!unlocked}
      />
    );
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="title">Train</Text>
        <Pressable
          onPress={() => setAddOpen(true)}
          style={[styles.addBtn, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}
        >
          <Ionicons name="add" size={20} color={t.ink.primary} />
        </Pressable>
      </View>

      <View style={[styles.search, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
        <Ionicons name="search" size={17} color={t.ink.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search movements"
          placeholderTextColor={t.ink.muted}
          style={[styles.input, { color: t.ink.primary }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searching ? <Ionicons name="close-circle" size={17} color={t.ink.muted} onPress={() => setQuery('')} /> : null}
      </View>

      {searching ? (
        results.length === 0 ? (
          <Text tone="muted" style={{ marginTop: Spacing.lg, textAlign: 'center' }}>
            No matches for &quot;{query.trim()}&quot;.
          </Text>
        ) : (
          <View style={{ marginTop: Spacing.md }}>
            <ListGroup>{results.map(row)}</ListGroup>
          </View>
        )
      ) : (
        SECTIONS.map((section) => {
          const items = EXERCISES.filter((e) => e.category === section.key).sort((a, b) => a.level - b.level);
          if (items.length === 0) return null;
          return (
            <View key={section.key} style={{ marginTop: Spacing.lg }}>
              <SectionLabel>{section.label}</SectionLabel>
              <ListGroup>{items.map(row)}</ListGroup>
            </View>
          );
        })
      )}

      <PurchaseModal exercise={buyTarget} onClose={() => setBuyTarget(null)} />
      <StartWorkoutSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

function StartWorkoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const go = (pathname: '/workout/builder' | '/workout/templates', params?: Record<string, string>) => {
    onClose();
    router.push(params ? { pathname, params } : pathname);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            Workout
          </Text>
          <Pressable
            onPress={() => go('/workout/builder', { mode: 'start' })}
            style={[styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
          >
            <Ionicons name="play-circle-outline" size={22} color={t.accent.color} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">Start workout</Text>
              <Text variant="caption" tone="secondary">Pick exercises and go — nothing saved</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
          </Pressable>
          <Pressable
            onPress={() => go('/workout/templates')}
            style={[styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
          >
            <Ionicons name="list-outline" size={22} color={t.accent.color} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">Choose template</Text>
              <Text variant="caption" tone="secondary">Ready-made or one you&apos;ve saved</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PurchaseModal({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  const t = useTheme();
  const { hasAllAccess } = useSubscription();
  if (hasAllAccess) return null;

  return (
    <Modal visible={exercise != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          <LockBadge size="lg" />
          <Text variant="heading" style={{ marginTop: Spacing.sm, textAlign: 'center' }}>
            {exercise?.name ?? ''}
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
            Unlock this exercise or get access to everything.
          </Text>

          <Pressable style={[styles.buyBtn, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{exercise?.name ?? ''}</Text>
              <Text variant="caption" tone="secondary">Just this exercise</Text>
            </View>
            <Text variant="heading" tone="accent">$1/mo</Text>
          </Pressable>

          <Pressable style={[styles.buyBtn, { backgroundColor: Feedback.good, borderColor: Feedback.good }]}>
            <View style={{ flex: 1 }}>
              <Text variant="heading" style={{ color: '#000' }}>All Access</Text>
              <Text variant="caption" style={{ color: 'rgba(0,0,0,0.6)' }}>Every exercise, future updates</Text>
            </View>
            <Text variant="heading" style={{ color: '#000' }}>$5/mo</Text>
          </Pressable>

          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
            Payments coming soon — use the All Access toggle in Settings for now.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
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
  input: { flex: 1, fontSize: 16, fontWeight: '500', paddingVertical: 0 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    alignItems: 'center',
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    width: '100%',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});