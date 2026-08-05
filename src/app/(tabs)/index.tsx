import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Atmosphere } from '@/components/Atmosphere';
import { ListGroup, ListRow } from '@/components/ListGroup';
import { PlanRows, StreakHook } from '@/components/PaywallOffer';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { StreakFlame } from '@/components/StreakFlame';
import { Text } from '@/components/Text';
import { useActiveExercises } from '@/exercises/registry';
import { getExercise } from '@/exercises/data';
import { getDailyChallenge, isChallengeComplete } from '@/exercises/challenges';
import type { Exercise } from '@/exercises/types';
import { formatClock, formatRelativeDay } from '@/lib/format';
import { computeStreakDays } from '@/lib/insights';
import { computeRanks, rankColor } from '@/lib/rank';
import { getSessions, type SessionRecord } from '@/lib/sessionCache';
import { useChallengeStore } from '@/store/challenge';
import { useProfile } from '@/store/profile';
import { useProgram } from '@/store/program';
import { FREE_EXERCISES, useSubscription } from '@/store/subscription';
import { useUiStore } from '@/store/ui';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function TrainScreen() {
  const t = useTheme();
  const exercises = useActiveExercises();
  const profile = useProfile();
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const isExerciseUnlocked = (slug: string) => hasAllAccess || FREE_EXERCISES.includes(slug);
  const [buyTarget, setBuyTarget] = useState<Exercise | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const setOverlayOpen = useUiStore((s) => s.setOverlayOpen);
  useEffect(() => {
    setOverlayOpen(buyTarget != null || addOpen);
    return () => setOverlayOpen(false);
  }, [buyTarget, addOpen, setOverlayOpen]);

  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, object | undefined>>>();
  useEffect(() => {
    // 'tabPress' fires only on an actual tab-button tap (switching tabs, or
    // re-tapping the already-active one) — NOT on a plain focus event, so
    // coming back here via the back button (e.g. from /search, pushed by the
    // tab bar's search button) leaves scroll position alone instead of
    // yanking it back to top.
    return navigation.addListener('tabPress', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getSessions()
        .then((rows) => alive && setSessions(rows))
        .catch(() => alive && setSessions([]));
      return () => { alive = false; };
    }, []),
  );

  const streakDays = useMemo(
    () => (sessions ? computeStreakDays(sessions.map((s) => s.createdAt)) : 0),
    [sessions],
  );

  const ranks = useMemo(
    () =>
      sessions
        ? computeRanks(sessions, { heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, age: profile.age })
        : [],
    [sessions, profile.heightCm, profile.weightKg, profile.sex, profile.age],
  );

  // "Continue your progression" — whichever tracked exercise is CLOSEST to
  // leveling up (highest progressToNext among those with a next tier), not
  // just whatever was trained last. This is the one thing Train shows that
  // Profile doesn't: a specific next action, not a stats summary.
  const continueRank = useMemo(() => {
    const withNext = ranks.filter((r) => r.nextTier != null);
    if (withNext.length === 0) return null;
    return [...withNext].sort((a, b) => b.progressToNext - a.progressToNext)[0];
  }, [ranks]);

  const open = (slug: string) => {
    if (isExerciseUnlocked(slug)) {
      router.push({ pathname: '/exercise/[slug]', params: { slug } });
    } else {
      const ex = getExercise(slug);
      if (ex) setBuyTarget(ex);
    }
  };

  return (
    <Screen scroll ref={scrollRef}>
      <Atmosphere />
      <View style={styles.header}>
        <View>
          <Text variant="label" tone="muted">TODAY</Text>
          <Text variant="title">Train</Text>
        </View>
        <View style={{ flex: 1 }} />
        {streakDays > 0 ? (
          <Pressable onPress={() => router.push('/(tabs)/insights')} style={styles.streakPill} hitSlop={4}>
            <StreakFlame days={streakDays} />
            <Text variant="heading" style={{ marginLeft: -6 }}>{streakDays}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.heroCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairlineStrong }]}>
        <View style={styles.heroCopy}>
          <Text variant="label" tone="accent">YOUR PRACTICE</Text>
          <Text variant="hero" style={{ marginTop: Spacing.xs }}>
            Move well.{`\n`}Get stronger.
          </Text>
          <Text tone="secondary" style={{ marginTop: Spacing.sm }}>
            Pick a movement and let ISOFORM handle the counting, timing, and feedback.
          </Text>
        </View>
        <PrimaryButton
          label="Start a session"
          variant="hero"
          icon={<Ionicons name="arrow-forward" size={24} color={t.accent.onColor} />}
          onPress={() => setAddOpen(true)}
          style={{ marginTop: Spacing.lg }}
        />
      </View>

      <ChallengeCardCmp sessions={sessions} />
      <ProgramBannerCmp />

      {/* Only ever the exercise closest to leveling up — no "you haven't
          trained X in a while" nudge. That kind of suggestion reads as
          judgmental to some people, and "closest to the next tier" is
          already a real, motivating reason to show something. */}
      {continueRank ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text variant="label" tone="muted">Up next</Text>
          <View style={{ marginTop: Spacing.sm }}>
            <ListGroup>
              <ListRow
                title={continueRank.exerciseName}
                subtitle={`${continueRank.remainingToNext} more ${continueRank.mode === 'reps' ? 'reps' : 'seconds'} to ${continueRank.nextTier}`}
                icon={
                  <View style={[styles.rankIconBadge, { backgroundColor: `${rankColor(continueRank.tier)}22` }]}>
                    <Ionicons name="trending-up" size={18} color={rankColor(continueRank.tier)} />
                  </View>
                }
                onPress={() => open(continueRank.exerciseId)}
              />
            </ListGroup>
          </View>
        </View>
      ) : null}

      {!continueRank && sessions != null ? (
        <View style={[styles.empty, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
          <View style={[styles.emptyIconWrap, { backgroundColor: t.surface.sunken }]}>
            <Ionicons name="search-outline" size={28} color={t.ink.muted} />
          </View>
          <Text variant="heading" style={{ textAlign: 'center', marginTop: Spacing.md }}>Find a movement</Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
            Search for an exercise to start your first set.
          </Text>
          <PrimaryButton
            label="Browse exercises"
            variant="outline"
            icon={<Ionicons name="search" size={18} color={t.ink.primary} />}
            onPress={() => router.push('/search')}
            style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
          />
        </View>
      ) : null}

      {sessions && sessions.length > 0 ? (
        <View style={{ marginTop: Spacing.xl }}>
          <Text variant="label" tone="muted">Recent</Text>
          <View style={{ marginTop: Spacing.sm }}>
            <ListGroup>
              {sessions.slice(0, 2).map((s) => (
                <ListRow
                  key={s.id}
                  title={s.exerciseName}
                  subtitle={`${formatRelativeDay(s.createdAt)} · ${formatClock(s.durationMs)}${s.note ? ' · note' : ''}`}
                  onPress={() => router.push({ pathname: '/workout/review/[id]', params: { id: s.id } })}
                  right={
                    <Text variant="body" tone="secondary">
                      {s.reps > 0 ? `${s.reps} reps` : `${s.holdSeconds}s`}
                    </Text>
                  }
                />
              ))}
            </ListGroup>
          </View>
        </View>
      ) : null}

      {/* Clears the floating tab bar (64 height + 24 bottom margin ≈ 88pt) —
          Screen's own default scroll padding alone isn't enough to stop the
          last row from sitting under it. */}
      <View style={{ height: Spacing.xxl }} />

      <PurchaseModal
        exercise={buyTarget}
        lockedCount={Math.max(0, exercises.length - FREE_EXERCISES.length)}
        onClose={() => setBuyTarget(null)}
      />
      <StartWorkoutSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

function StartWorkoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const [view, setView] = useState<'main' | 'startChoice'>('main');

  const close = () => {
    onClose();
    setTimeout(() => setView('main'), 250);
  };
  const haptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const go = (pathname: '/workout/builder' | '/workout/templates', params?: Record<string, string>) => {
    haptic();
    onClose();
    setView('main');
    router.push(params ? { pathname, params } : pathname);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          {view === 'main' ? (
            <>
              <Text variant="heading" style={{ textAlign: 'center' }}>
                Workout
              </Text>
              <Pressable
                onPress={() => { haptic(); onClose(); setView('main'); router.push('/search'); }}
                style={({ pressed }) => [styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="search-outline" size={22} color={t.accent.color} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">Browse</Text>
                  <Text variant="caption" tone="secondary">See every movement and start training</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
              </Pressable>
              <Pressable
                onPress={() => { haptic(); setView('startChoice'); }}
                style={({ pressed }) => [styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="play-circle-outline" size={22} color={t.accent.color} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">Start workout</Text>
                  <Text variant="caption" tone="secondary">From a template, or build one now</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                <Pressable onPress={() => { haptic(); setView('main'); }} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="chevron-back" size={22} color={t.ink.muted} />
                </Pressable>
                <Text variant="heading" style={{ flex: 1, textAlign: 'center', marginRight: 26 }}>
                  Start workout
                </Text>
              </View>
              <Pressable
                onPress={() => go('/workout/templates')}
                style={({ pressed }) => [styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="list-outline" size={22} color={t.accent.color} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">From template</Text>
                  <Text variant="caption" tone="secondary">Ready-made or one you&apos;ve saved</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
              </Pressable>
              <Pressable
                onPress={() => go('/workout/builder', { mode: 'start' })}
                style={({ pressed }) => [styles.sheetRow, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="add-circle-outline" size={22} color={t.accent.color} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">Start new</Text>
                  <Text variant="caption" tone="secondary">Pick exercises and go — nothing saved yet</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChallengeCardCmp({ sessions }: { sessions: SessionRecord[] | null }) {
  const t = useTheme();
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);
  const history = useChallengeStore((s) => s.history);
  const [challengeOpen, setChallengeOpen] = useState(false);

  const challenge = useMemo(
    () => {
      try {
        return sessions ? getDailyChallenge(new Date(), sessions, hasAllAccess) : null;
      } catch {
        return null;
      }
    },
    [sessions, hasAllAccess],
  );

  if (!challenge) return null;

  const today = new Date().toISOString().slice(0, 10);
  const saved = history[today];
  const done = saved && isChallengeComplete(challenge, saved) ? saved : null;

  if (done) {
    const completedValue = challenge.mode === 'best-form'
      ? `${done.score ?? 0} score`
      : challenge.mode === 'hold-target' || challenge.mode === 'max-hold'
        ? `${done.bestHoldSeconds}s`
      : `${done.totalReps ?? done.bestReps} reps`;
    return (
      <View
        style={[styles.card, { backgroundColor: t.surface.raised, borderColor: Feedback.good }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Ionicons name="checkmark-circle" size={22} color={Feedback.good} />
          <Text variant="heading" style={{ color: Feedback.good }}>Challenge complete</Text>
        </View>
        <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
          {challenge.title} · {getExercise(challenge.exerciseSlug)?.name ?? challenge.exerciseName}
        </Text>
        <Text variant="display" style={{ marginTop: Spacing.sm, color: Feedback.good }}>{completedValue}</Text>
        <Text variant="caption" tone="secondary" style={{ marginTop: Spacing.xs }}>
          Minimum: {challenge.minimum} {challenge.minimumLabel}
        </Text>
      </View>
    );
  }

  const exercise = getExercise(challenge.exerciseSlug);
  const startChallenge = () => {
    setChallengeOpen(false);
    router.push({
      pathname: '/workout/active',
        params: {
          slug: challenge.exerciseSlug,
          challengeId: challenge.id,
          challengeTarget: challenge.target != null ? String(challenge.target) : '0',
          challengeMode: challenge.mode,
          challengeMinimum: String(challenge.minimum),
          challengeMinimumLabel: challenge.minimumLabel,
        },
    });
  };

  return (
    <>
      <Pressable
        onPress={() => setChallengeOpen(true)}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: t.surface.raised, borderColor: t.ink.hairline },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Ionicons name="play-circle" size={22} color={t.accent.color} />
          <Text variant="heading" style={{ color: t.accent.color }}>Today&apos;s challenge</Text>
        </View>
        <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
          {challenge.title} · {exercise?.name ?? challenge.exerciseName}
        </Text>
        {challenge.target != null ? (
          <Text variant="body" style={{ marginTop: Spacing.sm }}>
            Target: {challenge.target} {challenge.targetLabel}
          </Text>
        ) : null}
      </Pressable>

      <Modal visible={challengeOpen} transparent animationType="fade" onRequestClose={() => setChallengeOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setChallengeOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
            <Ionicons name="trophy-outline" size={28} color={t.accent.color} />
            <Text variant="label" tone="muted">TODAY&apos;S CHALLENGE</Text>
            <View
              style={[styles.challengeSummary, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}
            >
              <Text variant="heading">{exercise?.name ?? challenge.exerciseName}</Text>
              <View style={styles.challengeDetailRow}>
                <Text variant="caption" tone="muted">CHALLENGE</Text>
                <Text variant="body" style={{ fontWeight: '700', color: t.accent.color }}>{challenge.title}</Text>
              </View>
              <View style={styles.challengeDetailRow}>
                <Text variant="caption" tone="muted">MINIMUM</Text>
                <Text variant="body" style={{ fontWeight: '700' }}>{challenge.minimum} {challenge.minimumLabel}</Text>
              </View>
            </View>
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {challenge.target != null
                ? `Complete ${challenge.target} ${challenge.targetLabel} to hit today's target.`
                : challenge.mode === 'max-time'
                  ? 'Do as many clean reps as possible in 1 minute.'
                  : challenge.mode === 'max-hold'
                    ? 'Hold the position for as long as you can with good form.'
                    : 'Aim for your best form score on one clean set.'}
            </Text>
            <PrimaryButton
              label="Start challenge"
              variant="hero"
              icon={<Ionicons name="arrow-forward" size={22} color={t.accent.onColor} />}
              onPress={startChallenge}
              style={{ alignSelf: 'stretch' }}
            />
            <Pressable onPress={() => setChallengeOpen(false)} hitSlop={8}>
              <Text tone="muted">Not now</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ProgramBannerCmp() {
  const t = useTheme();
  const active = useProgram((s) => {
    const prog = s.activeProgram();
    return prog ? { prog, step: prog.steps[s.currentStepIndex], stepIndex: s.currentStepIndex, totalSteps: prog.steps.length } : null;
  });

  if (!active) return null;

  const ex = getExercise(active.step.exerciseSlug);
  const req = active.step.requirement;
  const reqText = req.type === 'reps' ? `${req.value} reps` : `${req.value}s hold`;
  const formText = req.minFormScore != null ? ` · ${req.minFormScore}+ form` : '';

  return (
    <Pressable
      onPress={() => {
        router.push({
          pathname: '/workout/active',
          params: { slug: active.step.exerciseSlug },
        });
      }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: t.surface.raised, borderColor: t.ink.hairline },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <Ionicons name="fitness" size={22} color={t.accent.color} />
        <Text variant="heading" style={{ color: t.accent.color }}>{active.prog.name}</Text>
      </View>
      <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
        Step {active.stepIndex + 1} of {active.totalSteps} · {ex?.name ?? active.step.exerciseSlug}
      </Text>
      <Text variant="body" style={{ marginTop: Spacing.xs }}>
        {reqText}{formText}
      </Text>
      <Text variant="caption" tone="secondary" style={{ marginTop: Spacing.sm }}>
        {active.step.tip}
      </Text>
    </Pressable>
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
          <Text variant="heading" style={{ marginTop: Spacing.sm, textAlign: 'center' }}>
            {exercise?.name ?? ''} is locked
          </Text>
          {/* Loss-framed, not just "here's what you get" — naming what's
              currently missing converts better than a plain feature list. */}
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
  heroCard: { marginTop: Spacing.lg, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  heroCopy: { maxWidth: 310 },
  streakPill: { flexDirection: 'row', alignItems: 'center' },
  card: {
    marginTop: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  challengeSummary: {
    alignSelf: 'stretch',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  challengeDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  empty: {
    marginTop: Spacing.lg,
    padding: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankIconBadge: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
