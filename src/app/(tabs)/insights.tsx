import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { ACHIEVEMENT_BADGES, BADGE_ASPECT, BADGE_ICON_COLOR, computeAchievements, type AchievementStatus } from '@/lib/achievements';
import { Atmosphere } from '@/components/Atmosphere';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { RankShareCard, type RankShareCardHandle } from '@/components/RankShareCard';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { computeInsights } from '@/lib/insights';
import { formatClock, formatCount, formatDuration, formatRelativeDay } from '@/lib/format';
import { MUSCLE_LABEL } from '@/lib/muscleLabels';
import { computeRanks, RANK_ICON_ASPECT, RANK_ICONS, rankColor, tierRequirements } from '@/lib/rank';
import { getExercise, getPrevProgression } from '@/exercises/data';
import type { Exercise } from '@/exercises/types';
import { getSessions, type SessionRecord } from '@/lib/sessionCache';
import { useProfile } from '@/store/profile';
import { Feedback, formQualityColor, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const RANK_EXPLAINER =
  'Estimated from calisthenics community benchmarks, adjusted for your body stats, sex, age, and form — not a scientific measurement, just a fun way to track progress. All of that is optional in Settings.';

export default function InsightsScreen() {
  const t = useTheme();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [rankPickedId, setRankPickedId] = useState<string | null>(null);
  const [rankInfoOpen, setRankInfoOpen] = useState(false);
  const profile = useProfile();
  const rankShareRef = useRef<RankShareCardHandle>(null);
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

  const insights = useMemo(() => (sessions ? computeInsights(sessions) : null), [sessions]);
  const ranks = useMemo(
    () =>
      sessions
        ? computeRanks(sessions, { heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, age: profile.age })
        : [],
    [sessions, profile.heightCm, profile.weightKg, profile.sex, profile.age],
  );
  const achievements = useMemo(() => (sessions ? computeAchievements({ sessions }) : []), [sessions]);

  const struggling = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const perEx = new Map<string, { name: string; slug: string; scores: number[]; family: string }>();
    for (const s of sessions) {
      if (s.score == null) continue;
      const ex = getExercise(s.exerciseId);
      if (!ex) continue;
      const cur = perEx.get(s.exerciseId) ?? { name: s.exerciseName, slug: s.exerciseId, scores: [], family: ex.family };
      cur.scores.push(s.score);
      perEx.set(s.exerciseId, cur);
    }
    const results: { name: string; slug: string; avgScore: number; prev: ReturnType<typeof getPrevProgression> }[] = [];
    for (const [, v] of perEx) {
      if (v.scores.length < 2) continue;
      const avg = v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
      if (avg >= 55) continue;
      const ex = getExercise(v.slug);
      if (!ex) continue;
      const prev = getPrevProgression(ex);
      if (!prev) continue;
      results.push({ name: v.name, slug: v.slug, avgScore: Math.round(avg), prev });
    }
    return results.sort((a, b) => a.avgScore - b.avgScore);
  }, [sessions]);

  // One entry per exercise with any stats, ordered by how strong your best is
  // (bests is already sorted that way) — the picker below lets you drill into
  // just one instead of dumping every exercise you've ever tried in a list.
  const statEntries = useMemo(() => {
    if (!insights) return [];
    const order: string[] = [];
    const map = new Map<string, { exerciseId: string; exerciseName: string; best?: (typeof insights.bests)[number]; total?: (typeof insights.lifetimeTotals)[number] }>();
    for (const b of insights.bests) {
      order.push(b.exerciseId);
      map.set(b.exerciseId, { exerciseId: b.exerciseId, exerciseName: b.exerciseName, best: b });
    }
    for (const l of insights.lifetimeTotals) {
      const cur = map.get(l.exerciseId);
      if (cur) cur.total = l;
      else {
        order.push(l.exerciseId);
        map.set(l.exerciseId, { exerciseId: l.exerciseId, exerciseName: l.exerciseName, total: l });
      }
    }
    return order.map((id) => map.get(id)!);
  }, [insights]);

  // Default to the most IMPRESSIVE record, not the biggest raw number — a
  // difficulty-normalized rank (ranks is already sorted best-first) means
  // e.g. 1,000 push-ups outranks 1,001 squats. Only falls back to raw-value
  // order if nothing has a rank yet (no body-stat-independent exercises tracked).
  const defaultStatId = ranks[0]?.exerciseId ?? statEntries[0]?.exerciseId ?? null;
  const selectedId = pickedId && statEntries.some((e) => e.exerciseId === pickedId) ? pickedId : defaultStatId;
  const selected = statEntries.find((e) => e.exerciseId === selectedId) ?? null;

  const rankSelectedId = rankPickedId && ranks.some((r) => r.exerciseId === rankPickedId) ? rankPickedId : ranks[0]?.exerciseId ?? null;
  const rankSelected = ranks.find((r) => r.exerciseId === rankSelectedId) ?? null;

  return (
    <>
    <Screen scroll ref={scrollRef}>
      <Atmosphere />
      <View style={styles.header}>
        <Text variant="title">Profile</Text>
        <Pressable onPress={() => router.push('/settings')} hitSlop={10} style={styles.gearBtn}>
          <Ionicons name="settings-outline" size={22} color={t.ink.secondary} />
        </Pressable>
      </View>

      {profile.heightCm == null || profile.weightKg == null || profile.age == null ? (
        <Pressable
          onPress={() => router.push({ pathname: '/settings', params: { section: 'bodyStats' } })}
          style={[styles.completeBanner, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}
        >
          <Ionicons name="person-circle-outline" size={22} color={t.accent.color} />
          <View style={{ flex: 1 }}>
            <Text variant="body">Complete your profile</Text>
            <Text variant="caption" tone="secondary">Add your height, weight, and age for accurate ranks</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.ink.muted} />
        </Pressable>
      ) : null}

      {sessions == null ? (
        <Text tone="muted" style={{ marginTop: Spacing.lg }}>Loading...</Text>
      ) : sessions.length === 0 ? (
        <Empty />
      ) : insights ? (
        <>
          {/* Hero: rank + streak are "who you are right now" — this leads the
              screen instead of being buried under a flat stack of equal-weight
              stat boxes. */}
          {ranks.length > 0 && rankSelected ? (
            <View style={{ marginTop: Spacing.md }}>
              <View style={styles.sectionHeaderRow}>
                <SectionLabel>Your rank</SectionLabel>
                <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                  <Pressable
                    hitSlop={10}
                    onPress={() => router.push('/rank-check')}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Ionicons name="search" size={16} color={t.ink.muted} />
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    onPress={() => rankShareRef.current?.share()}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Ionicons name="share-outline" size={16} color={t.ink.muted} />
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    onPress={() => setRankInfoOpen(true)}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Text variant="body" tone="muted" style={{ fontWeight: '700' }}>?</Text>
                  </Pressable>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                style={{ marginBottom: Spacing.sm }}
              >
                {ranks.map((r) => {
                  const on = r.exerciseId === rankSelectedId;
                  return (
                    <Pressable
                      key={r.exerciseId}
                      onPress={() => setRankPickedId(r.exerciseId)}
                      style={[
                        styles.chip,
                        { backgroundColor: on ? t.ink.primary : t.surface.raised, borderColor: on ? t.ink.primary : t.ink.hairline },
                      ]}
                    >
                      <Text variant="caption" style={{ color: on ? t.surface.base : t.ink.secondary, fontWeight: '700' }}>
                        {r.exerciseName}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={[styles.rankCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
                {/* A true radial-gradient glow (not just a flat dark card)
                    behind the badge, tinted to that tier's own metal color —
                    this is what makes the card feel like a lit gem instead of
                    art sitting on a plain dark box. */}
                <View style={styles.badgeGlowWrap}>
                  <Svg width={220} height={220} style={{ position: 'absolute' }}>
                    <Defs>
                      <RadialGradient id="rankGlow" cx="50%" cy="50%" r="50%">
                        <Stop offset="0%" stopColor={rankColor(rankSelected.tier)} stopOpacity={0.5} />
                        <Stop offset="55%" stopColor={rankColor(rankSelected.tier)} stopOpacity={0.18} />
                        <Stop offset="100%" stopColor={rankColor(rankSelected.tier)} stopOpacity={0} />
                      </RadialGradient>
                    </Defs>
                    <Circle cx={110} cy={110} r={110} fill="url(#rankGlow)" />
                  </Svg>
                  <Image
                    // Keyed by tier: without this, switching exercises could
                    // show the PREVIOUS tier's bitmap stretched into the new
                    // tier's aspect ratio for a frame (container resizes
                    // instantly on re-render, but an unkeyed Image's old
                    // bitmap lingers until the new source finishes loading) —
                    // a full remount avoids it.
                    key={rankSelected.tier}
                    source={RANK_ICONS[rankSelected.tier]}
                    style={{ height: 190, aspectRatio: RANK_ICON_ASPECT[rankSelected.tier] }}
                    resizeMode="contain"
                  />
                </View>
                <Text variant="heading" style={{ color: rankColor(rankSelected.tier), marginTop: Spacing.sm }}>
                  {rankSelected.tier}
                </Text>
                <Text variant="caption" tone="secondary">
                  {rankSelected.exerciseName} · {rankSelected.mode === 'reps' ? `${rankSelected.value} reps` : `${rankSelected.value}s hold`}
                </Text>
                {rankSelected.nextTier ? (
                  <>
                    <View style={[styles.rankProgressTrack, { backgroundColor: t.surface.sunken }]}>
                      <View
                        style={[
                          styles.rankProgressFill,
                          { width: `${Math.round(rankSelected.progressToNext * 100)}%`, backgroundColor: rankColor(rankSelected.tier) },
                        ]}
                      />
                    </View>
                    <Text variant="caption" tone="muted">
                      {rankSelected.remainingToNext} more {rankSelected.mode === 'reps' ? 'reps' : 'seconds'} to {rankSelected.nextTier}
                    </Text>
                  </>
                ) : (
                  <Text variant="caption" style={{ color: rankColor(rankSelected.tier), marginTop: 4 }}>
                    Top rank reached — Gold IV!
                  </Text>
                )}
              </View>
              <RankShareCard
                ref={rankShareRef}
                tier={rankSelected.tier}
                exerciseName={rankSelected.exerciseName}
                mode={rankSelected.mode}
                value={rankSelected.value}
              />
            </View>
          ) : null}

          {insights.avgScore != null ? (
            <View style={{ marginTop: Spacing.sm }}>
              <SectionLabel>Form score</SectionLabel>
              <View style={[styles.scoreCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.scoreValue, { color: formQualityColor(insights.avgScore) }]}>
                    {insights.avgScore}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    Average of your last {insights.scoreTrend.length} set{insights.scoreTrend.length === 1 ? '' : 's'}
                  </Text>
                </View>
                {insights.scoreTrend.length > 1 ? (
                  <View style={styles.sparkline}>
                    {insights.scoreTrend.map((p, i) => (
                      <View
                        key={i}
                        style={[
                          styles.sparkBar,
                          { height: 8 + (p.score / 100) * 48, backgroundColor: formQualityColor(p.score) },
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.statRow}>
            <StatBox label="Streak" value={String(insights.streakDays)} icon="flame" tint="#FF6A2E" />
            <StatBox label="Total sessions" value={String(insights.totalSessions)} icon="barbell" tint={Feedback.good} />
            <StatBox label="Time trained" value={formatDuration(insights.totalTimeMs)} icon="time" tint="#BF9CFF" />
          </View>

          {statEntries.length > 0 && selected ? (
            <View style={{ marginTop: Spacing.lg }}>
              <SectionLabel>Records</SectionLabel>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                style={{ marginBottom: Spacing.sm }}
              >
                {statEntries.map((e) => {
                  const on = e.exerciseId === selectedId;
                  return (
                    <Pressable
                      key={e.exerciseId}
                      onPress={() => setPickedId(e.exerciseId)}
                      style={[
                        styles.chip,
                        { backgroundColor: on ? t.ink.primary : t.surface.raised, borderColor: on ? t.ink.primary : t.ink.hairline },
                      ]}
                    >
                      <Text variant="caption" style={{ color: on ? t.surface.base : t.ink.secondary, fontWeight: '700' }}>
                        {e.exerciseName}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: selected.exerciseId } })}>
                <ListGroup>
                  <ListRow
                    title="Personal record"
                    subtitle="Your single best set"
                    right={
                      selected.best ? (
                        <View style={styles.bestRight}>
                          <Text variant="heading">
                            {selected.best.mode === 'reps' ? `${selected.best.value}` : `${selected.best.value}s`}
                          </Text>
                          <Text variant="caption" tone="muted">{selected.best.mode === 'reps' ? 'reps' : 'hold'}</Text>
                        </View>
                      ) : (
                        <Text variant="caption" tone="muted">—</Text>
                      )
                    }
                  />
                  <ListRow
                    title="Lifetime total"
                    subtitle="Every session, ever"
                    right={
                      selected.total ? (
                        <View style={styles.bestRight}>
                          <Text variant="heading">
                            {selected.total.mode === 'reps' ? formatCount(selected.total.total) : formatDuration(selected.total.total * 1000)}
                          </Text>
                          <Text variant="caption" tone="muted">{selected.total.mode === 'reps' ? 'reps ever' : 'held ever'}</Text>
                        </View>
                      ) : (
                        <Text variant="caption" tone="muted">—</Text>
                      )
                    }
                  />
                </ListGroup>
              </Pressable>
            </View>
          ) : null}

          {achievements.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <View style={styles.sectionHeaderRow}>
                <SectionLabel>Achievements</SectionLabel>
                <Text variant="caption" tone="muted">
                  {achievements.filter((a) => a.unlocked).length}/{achievements.length}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.achRow}>
                {achievements.map((a) => (
                  <AchievementTile key={a.id} a={a} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {insights.readyToProgress.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <SectionLabel>Ready to progress</SectionLabel>
              <ListGroup>
                {insights.readyToProgress.slice(0, 5).map((r) => (
                  <ListRow
                    key={r.exerciseId}
                    title={r.nextName}
                    subtitle={`Your ${r.exerciseName} is looking strong (${r.score})`}
                    onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: r.nextSlug } })}
                    right={<Ionicons name="trending-up" size={18} color={Feedback.good} />}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}

          {struggling.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <SectionLabel>Struggling?</SectionLabel>
              <ListGroup>
                {struggling.slice(0, 3).map((r) => (
                  <ListRow
                    key={r.slug}
                    title={r.name}
                    subtitle={`Avg score ${r.avgScore} — try regressing to ${r.prev!.name}`}
                    onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: r.prev!.slug } })}
                    right={<Ionicons name="arrow-down" size={18} color={Feedback.warn} />}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}

          {insights.muscleFocus.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <SectionLabel>Muscle focus</SectionLabel>
              <View style={[styles.muscleCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
                {insights.muscleFocus.slice(0, 6).map((m) => {
                  const max = insights.muscleFocus[0].count;
                  const totalAll = insights.muscleFocus.reduce((sum, x) => sum + x.count, 0);
                  const barPct = Math.max(6, (m.count / max) * 100);
                  const sharePct = totalAll > 0 ? Math.round((m.count / totalAll) * 100) : 0;
                  return (
                    <View key={m.muscle} style={styles.muscleRow}>
                      <Text variant="caption" tone="secondary" style={styles.muscleLabel}>
                        {MUSCLE_LABEL[m.muscle] ?? m.muscle}
                      </Text>
                      <View style={[styles.muscleTrack, { backgroundColor: t.surface.sunken }]}>
                        <View style={[styles.muscleFill, { width: `${barPct}%`, backgroundColor: t.ink.muted }]} />
                      </View>
                      <Text variant="caption" tone="muted" style={styles.muscleCount}>
                        {sharePct}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ marginTop: Spacing.lg }}>
            <SectionLabel>Weekly activity</SectionLabel>
            <View style={[styles.weekCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
              <View style={styles.weekBars}>
                {insights.last7Days.map((d, i) => {
                  const max = Math.max(1, ...insights.last7Days.map((x) => x.count));
                  const h = d.count === 0 ? 4 : 12 + (d.count / max) * 60;
                  // Today (the rightmost bar) is the one accent moment in this
                  // chart — every other day, active or not, stays neutral so the
                  // brand color doesn't get spent on a plain comparison chart.
                  const isToday = i === 6;
                  const barColor = d.count === 0 ? t.surface.pressed : isToday ? t.accent.color : t.ink.muted;
                  return (
                    <View key={i} style={styles.weekCol}>
                      <View style={[styles.weekBar, { height: h, backgroundColor: barColor }]} />
                      <Text variant="label" tone={isToday ? 'accent' : 'muted'}>{d.label}</Text>
                    </View>
                  );
                })}
              </View>
              {insights.weekReps > 0 || insights.weekHoldSeconds > 0 ? (
                <View style={[styles.weekTotals, { borderTopColor: t.ink.hairline }]}>
                  {insights.weekReps > 0 ? <Text variant="label" tone="secondary">{insights.weekReps} reps</Text> : null}
                  {insights.weekHoldSeconds > 0 ? <Text variant="label" tone="secondary">{Math.floor(insights.weekHoldSeconds / 60)}m {insights.weekHoldSeconds % 60}s held</Text> : null}
                </View>
              ) : null}
            </View>
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionLabel>Recent</SectionLabel>
            <ListGroup>
              {sessions.slice(0, 8).map((s) => (
                <ListRow
                  key={s.id}
                  title={s.exerciseName}
                  subtitle={`${formatRelativeDay(s.createdAt)} · ${formatClock(s.durationMs)}${s.note ? ' · 📝' : ''}`}
                  onPress={() => router.push({ pathname: '/workout/review/[id]', params: { id: s.id } })}
                  right={
                    <View style={styles.bestRight}>
                      <Text variant="body">{s.reps > 0 ? `${s.reps} reps` : `${s.holdSeconds}s`}</Text>
                      {s.score != null ? (
                        <Text variant="caption" style={{ color: formQualityColor(s.score) }}>{s.score} score</Text>
                      ) : null}
                    </View>
                  }
                />
              ))}
            </ListGroup>
          </View>

          {/* Clears the floating tab bar */}
          <View style={{ marginTop: Spacing.lg }}>
            <SectionLabel>Activity</SectionLabel>
            <View style={[styles.weekCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
              <CalendarHeatmap dates={sessions.map((s) => s.createdAt)} />
            </View>
          </View>
          <View style={{ height: Spacing.xxl + Spacing.lg }} />
        </>
      ) : null}
    </Screen>
    <RankInfoModal
      visible={rankInfoOpen}
      onClose={() => setRankInfoOpen(false)}
      exercise={rankSelected ? getExercise(rankSelected.exerciseId) ?? null : null}
      currentTier={rankSelected?.tier ?? null}
      profile={profile}
    />
    </>
  );
}

function RankInfoModal({
  visible,
  onClose,
  exercise,
  currentTier,
  profile,
}: {
  visible: boolean;
  onClose: () => void;
  exercise: Exercise | null;
  currentTier: string | null;
  profile: ReturnType<typeof useProfile.getState>;
}) {
  const t = useTheme();
  const rows = exercise
    ? tierRequirements(exercise, { heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, age: profile.age })
    : [];
  const unit = exercise?.mode === 'hold' ? 's' : ' reps';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        {/* Backdrop is a SIBLING behind the sheet, not an ancestor wrapping
            it — a ScrollView nested inside a Pressable can lose the touch
            responder to that Pressable (the drag never gets recognized as a
            scroll), which is exactly what made this unscrollable. Putting
            the dismiss-on-tap-outside Pressable behind the sheet instead
            removes any Pressable from the ScrollView's ancestry entirely. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[modalStyles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {exercise ? `${exercise.name} — every rank` : 'About your rank'}
          </Text>
          {rows.length > 0 ? (
            <ScrollView style={{ maxHeight: 360, width: '100%' }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 2 }}>
                {rows.map((r) => {
                  const isCurrent = r.tier === currentTier;
                  return (
                    <View
                      key={r.tier}
                      style={[
                        modalStyles.tierRow,
                        { borderColor: t.ink.hairline },
                        isCurrent && { backgroundColor: `${t.accent.color}22`, borderColor: t.accent.color },
                      ]}
                    >
                      <Text variant="body" style={isCurrent ? { color: t.accent.color, fontWeight: '700' } : undefined}>
                        {r.tier}
                      </Text>
                      <Text variant="body" tone={isCurrent ? undefined : 'secondary'} style={isCurrent ? { color: t.accent.color, fontWeight: '700' } : undefined}>
                        {r.value}{unit}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {RANK_EXPLAINER}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
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
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
});

function StatBox({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Color for the small tinted circle behind `icon`. */
  tint: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={[styles.statIconBadge, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={icon} size={15} color={tint} />
      </View>
      <Text style={[styles.statValue, { color: t.ink.primary }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function AchievementTile({ a }: { a: AchievementStatus }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() =>
        Alert.alert(a.title, a.unlocked ? `Unlocked — ${a.description}` : `Locked — ${a.description}`)
      }
      style={styles.achTile}
    >
      <View style={styles.achBadgeWrap}>
        <Image
          source={ACHIEVEMENT_BADGES[a.badge]}
          style={{ height: 56, aspectRatio: BADGE_ASPECT[a.badge], opacity: a.unlocked ? 1 : 0.35 }}
          resizeMode="contain"
        />
        <View style={styles.achIconOverlay}>
          <Ionicons
            name={a.icon}
            size={18}
            color={a.unlocked ? BADGE_ICON_COLOR[a.badge] : t.ink.muted}
            style={a.unlocked ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } } : undefined}
          />
        </View>
        {!a.unlocked ? (
          <View style={[styles.achLock, { backgroundColor: t.surface.sunken, borderColor: t.ink.hairline }]}>
            <Ionicons name="lock-closed" size={9} color={t.ink.muted} />
          </View>
        ) : null}
      </View>
      <Text variant="caption" tone={a.unlocked ? 'primary' : 'muted'} style={{ textAlign: 'center' }} numberOfLines={1}>
        {a.shortTitle}
      </Text>
    </Pressable>
  );
}

function Empty() {
  const t = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={[styles.emptyIconWrap, { backgroundColor: t.surface.sunken }]}>
        <Ionicons name="stats-chart-outline" size={28} color={t.ink.muted} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center', marginTop: Spacing.md }}>Nothing yet</Text>
      <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
        Finish a workout and your stats will build here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gearBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  completeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankCard: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: 2,
  },
  badgeGlowWrap: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  rankProgressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: Spacing.sm, width: '100%' },
  rankProgressFill: { height: '100%', borderRadius: 3 },
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  statBox: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  statIconBadge: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  scoreValue: { fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  sparkline: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 56 },
  sparkBar: { width: 6, borderRadius: 3 },
  muscleCard: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.md, gap: Spacing.sm },
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  muscleLabel: { width: 82 },
  muscleTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  muscleFill: { height: '100%', borderRadius: 4 },
  muscleCount: { width: 32, textAlign: 'right' },
  chipRow: { gap: Spacing.xs, paddingRight: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1 },
  achRow: { gap: Spacing.md, paddingRight: Spacing.md, paddingTop: 2 },
  achTile: { alignItems: 'center', width: 76, gap: 4 },
  achBadgeWrap: { width: 76, height: 60, alignItems: 'center', justifyContent: 'center' },
  achIconOverlay: { position: 'absolute' },
  achLock: {
    position: 'absolute',
    bottom: -2,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekCard: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.md },
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 90 },
  weekCol: { alignItems: 'center', gap: 6, flex: 1 },
  weekBar: { width: 16, borderRadius: 8 },
  weekTotals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1 },
  bestRight: { alignItems: 'flex-end', gap: 1 },
  empty: {
    marginTop: Spacing.xl,
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
});
