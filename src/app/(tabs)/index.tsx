import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { LockBadge } from '@/components/LockBadge';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EXERCISES, getExercise } from '@/exercises/data';
import type { Exercise, ExerciseCategory } from '@/exercises/types';
import { getDailyChallenge, getMotivation, scoreChallenge, type DailyChallenge } from '@/exercises/challenges';
import { PROGRAMS } from '@/exercises/programs';
import { listSessions, type SessionRecord } from '@/storage/db';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useProgram } from '@/store/program';
import { useChallengeStore } from '@/store/challenge';
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
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return EXERCISES.filter((e) => e.name.toLowerCase().includes(q));
  }, [query]);
  const searching = query.trim().length > 0;
  // Select the boolean directly (not the whole store) so this screen re-renders
  // the instant All Access flips in Settings — no app reload needed.
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);
  const [buyTarget, setBuyTarget] = useState<Exercise | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);
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
        <>
          <ChallengeCard />
          <ProgramBanner />
          {SECTIONS.map((section) => {
          const items = EXERCISES.filter((e) => e.category === section.key).sort((a, b) => a.level - b.level);
          if (items.length === 0) return null;
          return (
            <View key={section.key} style={{ marginTop: Spacing.lg }}>
              <SectionLabel>{section.label}</SectionLabel>
              <ListGroup>{items.map(row)}</ListGroup>
            </View>
          );
        })}
        </>
      )}

      <ProgramPickerModal visible={programPickerOpen} onClose={() => setProgramPickerOpen(false)} />
      <PurchaseModal exercise={buyTarget} onClose={() => setBuyTarget(null)} />
      <StartWorkoutSheet visible={addOpen} onClose={() => setAddOpen(false)} onPrograms={() => { setAddOpen(false); setProgramPickerOpen(true); }} />
    </Screen>
  );
}

function StartWorkoutSheet({ visible, onClose, onPrograms }: { visible: boolean; onClose: () => void; onPrograms: () => void }) {
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
          <Pressable
            onPress={onPrograms}
            style={[styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
          >
            <Ionicons name="flag" size={22} color={t.accent.color} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">Training programs</Text>
              <Text variant="caption" tone="secondary">Progressive skill plans to unlock advanced moves</Text>
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
            Real-time AI form coaching + rep tracking for every exercise.
          </Text>
          <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs, flexWrap: 'wrap', justifyContent: 'center' }}>
            {['Form coach', 'Depth gauge', 'Session review', 'Insights', 'All exercises', 'Training programs'].map((feat) => (
              <View key={feat} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="checkmark-circle" size={12} color={Feedback.good} />
                <Text variant="caption" tone="secondary">{feat}</Text>
              </View>
            ))}
          </View>

          <Pressable style={[styles.buyBtn, { backgroundColor: Feedback.good, borderColor: Feedback.good }]}>
            <View style={{ flex: 1 }}>
              <Text variant="heading" style={{ color: '#000' }}>All Access</Text>
              <Text variant="caption" style={{ color: 'rgba(0,0,0,0.6)' }}>Every exercise, form coach, programs, insights</Text>
            </View>
            <Text variant="heading" style={{ color: '#000' }}>$4.99/mo</Text>
          </Pressable>

          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
            Payments coming soon — use the All Access toggle in Settings for now.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChallengeCard() {
  const t = useTheme();
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const [motivation, setMotivation] = useState('');

  useEffect(() => {
    (async () => {
      const sessions = await listSessions().catch(() => [] as SessionRecord[]);
      const ch = getDailyChallenge(new Date(), sessions, hasAllAccess);
      if (!ch) { setChallenge(null); return; }
      setChallenge(ch);
      const s = scoreChallenge(ch, sessions);
      setScore(s);
      if (s != null) {
        const d = new Date();
        setMotivation(getMotivation(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()));
      }
      const hist = useChallengeStore.getState().getHistoryFor(ch.exerciseSlug);
      if (hist.length > 1) setPrevScore(hist[1].score);
    })();
  }, [hasAllAccess]);

  if (!challenge) return null;

  const exercise = getExercise(challenge.exerciseSlug);
  const name = exercise?.name ?? challenge.exerciseName;
  const icon = challenge.mode === 'max-hold' || challenge.mode === 'hold-target'
    ? 'timer-outline' : 'fitness-outline';
  const improved = prevScore != null && score != null && score > prevScore;
  const done = score != null;

  return (
    <View style={[styles.challengeCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      {done ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm }}>
            <View style={[styles.challengeBadge, { backgroundColor: Feedback.good }]}>
              <Ionicons name="checkmark" size={16} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="accent">Daily Challenge · Done</Text>
              <Text variant="heading" style={{ fontSize: 15 }}>
                {challenge.title}
              </Text>
              <Text variant="caption" tone="secondary">
                {name} · {score} {challenge.targetLabel === 'score' ? 'pts' : `/${challenge.target ?? '—'}${challenge.targetLabel}`}
                {improved ? ' · ' : null}
                {improved ? <Text variant="caption" style={{ color: Feedback.good }}>↑ +{score! - prevScore!}</Text> : null}
              </Text>
            </View>
            <Text variant="heading" style={{ fontSize: 26, color: Feedback.good }}>{score}</Text>
          </View>
          <View style={[styles.motivationBox, { backgroundColor: t.surface.sunken }]}>
            <Ionicons name="sparkles" size={13} color={t.accent.color} />
            <Text variant="caption" tone="secondary" style={{ flex: 1, marginLeft: Spacing.xs }}>
              {motivation}
            </Text>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={[styles.challengeBadge, { backgroundColor: t.accent.color }]}>
            <Ionicons name="trophy" size={14} color="#000" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="caption" tone="accent">Daily Challenge</Text>
              {improved ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="trending-up" size={12} color={Feedback.good} />
                  <Text variant="caption" style={{ color: Feedback.good, marginLeft: 2 }}>+{score! - prevScore!}</Text>
                </View>
              ) : null}
            </View>
            <Text variant="heading" style={{ fontSize: 15, marginTop: 1 }}>
              {challenge.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name={icon} size={12} color={t.ink.secondary} />
                <Text variant="caption" tone="secondary">{name}</Text>
              </View>
              <Text variant="caption" tone="muted">· {challenge.subtitle}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => {
              router.push({
                pathname: '/workout/active',
                params: { slug: challenge.exerciseSlug, challengeId: challenge.id, challengeTarget: String(challenge.target ?? 0) },
              });
            }}
            hitSlop={8}
          >
            <Ionicons name="play-circle" size={28} color={t.accent.color} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ProgramBanner() {
  const t = useTheme();
  const prog = useProgram();
  const program = prog.activeProgram();
  const step = prog.currentStep();

  if (!program || !step) return null;

  const exercise = getExercise(step.exerciseSlug);
  const nextIndex = prog.currentStepIndex + 1;
  const isLast = nextIndex >= program.steps.length;

  return (
    <Pressable style={[styles.progBanner, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <Ionicons name="flag" size={16} color={t.accent.color} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="accent">{program.name}</Text>
          <Text variant="heading" style={{ fontSize: 15 }}>
            Step {prog.currentStepIndex + 1} of {program.steps.length}: {exercise?.name ?? step.exerciseSlug}
          </Text>
          <Text variant="caption" tone="secondary">
            {step.requirement.type === 'hold'
              ? `${step.requirement.value}s hold`
              : `${step.requirement.value} reps`}
            {step.requirement.minFormScore != null ? ` · ${step.requirement.minFormScore}% form` : ''}
            {isLast ? ' — Final step' : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function ProgramPickerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const prog = useProgram();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          <Text variant="heading" style={{ textAlign: 'center' }}>Training Programs</Text>
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            Follow a progression to achieve a skill goal. Each step unlocks the next.
          </Text>
          {PROGRAMS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => { prog.startProgram(p.id); onClose(); }}
              style={[styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}
            >
              <Ionicons name="fitness" size={20} color={t.accent.color} />
              <View style={{ flex: 1 }}>
                <Text variant="heading" style={{ fontSize: 15 }}>{p.name}</Text>
                <Text variant="caption" tone="secondary">{p.description}</Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                  {p.steps.length} steps · {p.steps.map((s) => s.exerciseSlug).join(' → ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={t.ink.muted} />
            </Pressable>
          ))}
          {prog.isActive() && (
            <Pressable
              onPress={() => { prog.quitProgram(); onClose(); }}
              style={{ paddingVertical: Spacing.sm, alignItems: 'center' }}
            >
              <Text variant="caption" tone="secondary">Quit current program</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progBanner: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  challengeCard: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  challengeBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  challengeLocked: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill },
  motivationBox: { flexDirection: 'row', alignItems: 'flex-start', padding: Spacing.sm, borderRadius: Radius.sm },
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