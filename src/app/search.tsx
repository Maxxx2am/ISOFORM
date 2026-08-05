import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Atmosphere } from '@/components/Atmosphere';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { LockBadge } from '@/components/LockBadge';
import { PageHeader } from '@/components/PageHeader';
import { PlanRows, StreakHook } from '@/components/PaywallOffer';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useActiveExercises } from '@/exercises/registry';
import type { Exercise, ExerciseCategory } from '@/exercises/types';
import { MUSCLE_LABEL } from '@/lib/muscleLabels';
import { searchExercises } from '@/lib/search';
import { useFavorites } from '@/store/favorites';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useUiStore } from '@/store/ui';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const SECTIONS: { key: ExerciseCategory; label: string }[] = [
  { key: 'lower', label: 'Lower body' },
  { key: 'upper', label: 'Upper body' },
  { key: 'core', label: 'Core' },
  { key: 'full', label: 'Full body' },
];

const CATEGORY_LABEL: Record<ExerciseCategory, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s.label]),
) as Record<ExerciseCategory, string>;

const COMING_SOON = [
  { name: 'Biceps Curl', detail: 'Side-view arm tracking' },
  { name: 'Shoulder Press', detail: 'Front-view arm path' },
  { name: 'Reverse Lunge', detail: 'Side-view knee + hip control' },
  { name: 'Glute Bridge', detail: 'Side-view hip extension' },
  { name: 'Bent-Over Row', detail: 'Side-view back + elbow path' },
];

/** Short scannable tag instead of the exercise's full marketing summary —
 * e.g. "Upper body · Chest". */
function tagFor(ex: Exercise): string {
  const muscle = ex.muscles[0] ? MUSCLE_LABEL[ex.muscles[0]] : null;
  return muscle ? `${CATEGORY_LABEL[ex.category]} · ${muscle}` : CATEGORY_LABEL[ex.category];
}

/**
 * The full exercise catalog + search, split out of the Train tab so Train
 * itself can stay a curated "what to do right now" home screen instead of a
 * flat list of everything — this is where "browse everything" lives now,
 * one tap away via the search icon instead of being the whole tab.
 */
export default function SearchScreen() {
  const t = useTheme();
  const exercises = useActiveExercises();
  const favorites = useFavorites();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searching = query.trim().length > 0;
  const favoriteSlugs = useMemo(() => new Set(favorites.favorites), [favorites.favorites]);

  const favoritedExercises = useMemo(
    () => exercises.filter((e) => favoriteSlugs.has(e.slug)),
    [exercises, favoriteSlugs],
  );

  const results = useMemo(() => {
    const hits = searchExercises(deferredQuery, exercises);
    const favs = hits.filter((e) => favoriteSlugs.has(e.slug));
    const rest = hits.filter((e) => !favoriteSlugs.has(e.slug));
    return [...favs, ...rest];
  }, [deferredQuery, exercises, favoriteSlugs]);

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: exercises
          .filter((e) => e.category === section.key && !favoriteSlugs.has(e.slug))
          .sort((a, b) => a.level - b.level),
      })).filter((s) => s.items.length > 0),
    [exercises, favoriteSlugs],
  );
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);
  const availableExercises = useMemo(
    () => !hasAllAccess ? exercises.filter((e) => FREE_EXERCISES.includes(e.slug) && !favoriteSlugs.has(e.slug)) : [],
    [exercises, favoriteSlugs, hasAllAccess],
  );
  const visibleSections = sections;
  const [buyTarget, setBuyTarget] = useState<Exercise | null>(null);
  const setOverlayOpen = useUiStore((s) => s.setOverlayOpen);
  useEffect(() => {
    setOverlayOpen(buyTarget != null);
    return () => setOverlayOpen(false);
  }, [buyTarget, setOverlayOpen]);

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
        subtitle={tagFor(ex)}
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
      <Atmosphere />
      <PageHeader
        eyebrow="MOVEMENT LIBRARY"
        title="Find your next move"
        subtitle="Browse by goal, body area, or the movement you want to improve."
      />

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
            <Text variant="caption" tone="muted" style={{ marginBottom: Spacing.sm, marginLeft: 4 }}>
              {results.length} result{results.length === 1 ? '' : 's'}
            </Text>
            <ListGroup>{results.map(row)}</ListGroup>
          </View>
        )
      ) : (
        <>
          {availableExercises.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <SectionLabel>Available</SectionLabel>
              <ListGroup>{availableExercises.map(row)}</ListGroup>
            </View>
          ) : null}
          {(hasAllAccess ? favoritedExercises : favoritedExercises.filter((e) => FREE_EXERCISES.includes(e.slug))).length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: Spacing.sm, marginLeft: 4 }}>
                <Text variant="label" tone="muted" style={{ marginBottom: 0, marginLeft: 0 }}>
                  FAVORITES
                </Text>
                <Ionicons name="star" size={12} color={t.accent.color} style={{ marginBottom: 2 }} />
              </View>
               <ListGroup>{(hasAllAccess ? favoritedExercises : favoritedExercises.filter((e) => FREE_EXERCISES.includes(e.slug))).map(row)}</ListGroup>
            </View>
          ) : null}
          {visibleSections.map((section) => (
            <View key={section.key} style={{ marginTop: Spacing.lg }}>
              <SectionLabel>{section.label}</SectionLabel>
              <ListGroup>{section.items.map(row)}</ListGroup>
            </View>
          ))}
           <ComingSoon />
        </>
      )}

      <View style={{ height: Spacing.xxl }} />

      <PurchaseModal
        exercise={buyTarget}
        lockedCount={Math.max(0, exercises.length - FREE_EXERCISES.length)}
        onClose={() => setBuyTarget(null)}
      />
    </Screen>
  );
}

function ComingSoon() {
  return (
    <View style={{ marginTop: Spacing.lg }}>
      <SectionLabel>Coming soon</SectionLabel>
      <ListGroup>
        {COMING_SOON.map((item) => (
          <ListRow
            key={item.name}
            title={item.name}
            subtitle={item.detail}
            right={<Text variant="label" tone="muted">SOON</Text>}
            dimmed
          />
        ))}
      </ListGroup>
    </View>
  );
}

function PurchaseModal({
  exercise,
  lockedCount,
  onClose,
}: {
  exercise: Exercise | null;
  lockedCount: number;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={exercise != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          <LockBadge size="lg" />
          <Text variant="heading" style={{ marginTop: Spacing.sm, textAlign: 'center' }}>
            {exercise?.name ?? ''} is locked
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
            No rep count, no form score, no video review on {exercise?.name ?? 'this exercise'} — or on{' '}
            {lockedCount > 0 ? `the ${lockedCount} other exercise${lockedCount === 1 ? '' : 's'}` : 'anything else'} still locked.
          </Text>

          <StreakHook active={exercise != null} />
          <PlanRows exerciseName={exercise?.name ?? ''} lockedCount={lockedCount} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
});
