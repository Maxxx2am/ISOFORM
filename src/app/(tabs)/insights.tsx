import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { ACHIEVEMENT_BADGES, BADGE_ASPECT, BADGE_ICON_COLOR, computeAchievements, type AchievementStatus } from '@/lib/achievements';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { RankShareCard, type RankShareCardHandle } from '@/components/RankShareCard';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { computeInsights } from '@/lib/insights';
import { formatClock, formatCount, formatDuration, formatRelativeDay } from '@/lib/format';
import { computeRanks, RANK_ICON_ASPECT, RANK_ICONS, rankColor, tierRequirements } from '@/lib/rank';
import { getExercise } from '@/exercises/data';
import { useProfile } from '@/store/profile';
import { listSessions, type SessionRecord } from '@/storage/db';
import { Feedback, formQualityColor, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const RANK_EXPLAINER =
  'Estimated from calisthenics community benchmarks, adjusted for your body stats, sex, age, and form — not a scientific measurement, just a fun way to track progress. All of that is optional in Settings.';

const MUSCLE_LABEL: Record<string, string> = {
  quads: 'Quads', glutes: 'Glutes', hamstrings: 'Hamstrings', calves: 'Calves',
  chest: 'Chest', shoulders: 'Shoulders', triceps: 'Triceps', back: 'Back',
  biceps: 'Biceps', core: 'Core', forearms: 'Forearms', 'hip flexors': 'Hip flexors',
};

export default function InsightsScreen() {
  const t = useTheme();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [rankPickedId, setRankPickedId] = useState<string | null>(null);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [showAllMuscles, setShowAllMuscles] = useState(false);
  const profile = useProfile();
  const rankShareRef = useRef<RankShareCardHandle>(null);
  const sessionsCacheRef = useRef<{ data: SessionRecord[] | null; ts: number }>({ data: null, ts: 0 });

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const now = Date.now();
      if (sessionsCacheRef.current.data && now - sessionsCacheRef.current.ts < 30_000) {
        setSessions(sessionsCacheRef.current.data);
        return;
      }
      listSessions()
        .then((rows) => {
          sessionsCacheRef.current = { data: rows, ts: now };
          if (alive) setSessions(rows);
        })
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
  const achievements = useMemo(
    () =>
      sessions && insights
        ? computeAchievements({ sessions, totalReps: insights.totalReps, exercisesTrained: insights.exercisesTrained, ranks })
        : [],
    [sessions, insights, ranks],
  );

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
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="title">Insights</Text>
      </View>

      {sessions == null ? (
        <Text tone="muted" style={{ marginTop: Spacing.lg }}>Loading...</Text>
      ) : sessions.length === 0 ? (
        <Empty />
      ) : insights ? (
        <>
          <View style={styles.statGrid}>
            <StatBox label="Streak" value={`${insights.streakDays}d`} iconElement={<StreakFlame days={insights.streakDays} />} />
            <StatBox label="This week" value={String(insights.weekSessions)} icon="calendar" tint="#5AC8FA" />
            <StatBox label="Total sessions" value={String(insights.totalSessions)} icon="barbell" tint={Feedback.good} />
            <StatBox label="Time trained" value={formatDuration(insights.totalTimeMs)} icon="time" tint="#BF9CFF" />
          </View>

          {insights.avgScore != null ? (
            <View style={{ marginTop: Spacing.lg }}>
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

          {ranks.length > 0 && rankSelected ? (
            <View style={{ marginTop: Spacing.lg }}>
              <View style={styles.sectionHeaderRow}>
                <SectionLabel>Your rank</SectionLabel>
                <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                  <Pressable
                    hitSlop={10}
                    onPress={() => router.push('/rank-check')}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Ionicons name="search" size={12} color={t.ink.muted} />
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    onPress={() => rankShareRef.current?.share()}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Ionicons name="share-outline" size={12} color={t.ink.muted} />
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    onPress={() => {
                      const ex = rankSelected ? getExercise(rankSelected.exerciseId) : null;
                      if (!ex) {
                        Alert.alert('About your rank', RANK_EXPLAINER);
                        return;
                      }
                      const unit = ex.mode === 'hold' ? 's' : ' reps';
                      const rows = tierRequirements(ex, { heightCm: profile.heightCm, weightKg: profile.weightKg, sex: profile.sex, age: profile.age })
                        .map((r) => `${r.tier}: ${r.value}${unit}`)
                        .join('\n');
                      Alert.alert(`${ex.name} — every rank`, `${rows}\n\n${RANK_EXPLAINER}`);
                    }}
                    style={[styles.helpBtn, { borderColor: t.ink.hairline }]}
                  >
                    <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>?</Text>
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
                <Image
                  key={rankSelected.tier}
                  source={RANK_ICONS[rankSelected.tier]}
                  style={{ height: 140, aspectRatio: RANK_ICON_ASPECT[rankSelected.tier] }}
                  resizeMode="contain"
                />
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
                          <Text variant="heading" tone="accent">
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
                          <Text variant="heading" tone="accent">
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
                {(showAllAchievements ? achievements : achievements.slice(0, 4)).map((a) => (
                  <AchievementTile key={a.id} a={a} />
                ))}
                {achievements.length > 4 && !showAllAchievements ? (
                  <Pressable
                    onPress={() => setShowAllAchievements(true)}
                    style={[styles.achTile, { justifyContent: 'center' }]}
                  >
                    <View style={[styles.expandBadge, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
                      <Ionicons name="add" size={18} color={t.ink.secondary} />
                    </View>
                    <Text variant="caption" tone="muted">+{achievements.length - 4} more</Text>
                  </Pressable>
                ) : null}
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

          {insights.muscleFocus.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <View style={styles.sectionHeaderRow}>
                <SectionLabel>Muscle focus</SectionLabel>
                {insights.muscleFocus.length > 3 ? (
                  <Pressable onPress={() => setShowAllMuscles(!showAllMuscles)} hitSlop={8}>
                    <Text variant="caption" tone="muted">
                      {showAllMuscles ? 'Show less' : `+${insights.muscleFocus.length - 3} more`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.muscleCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
                {(showAllMuscles ? insights.muscleFocus : insights.muscleFocus.slice(0, 3)).map((m) => {
                  const max = insights.muscleFocus[0].count;
                  const pct = Math.max(6, (m.count / max) * 100);
                  return (
                    <View key={m.muscle} style={styles.muscleRow}>
                      <Text variant="caption" tone="secondary" style={styles.muscleLabel}>
                        {MUSCLE_LABEL[m.muscle] ?? m.muscle}
                      </Text>
                      <View style={[styles.muscleTrack, { backgroundColor: t.surface.sunken }]}>
                        <View style={[styles.muscleFill, { width: `${pct}%`, backgroundColor: t.accent.color }]} />
                      </View>
                      <Text variant="caption" tone="muted" style={styles.muscleCount}>
                        {m.count}
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
                  return (
                    <View key={i} style={styles.weekCol}>
                      <View style={[styles.weekBar, { height: h, backgroundColor: d.count > 0 ? t.accent.color : t.surface.pressed }]} />
                      <Text variant="label" tone={i === 6 ? 'primary' : 'muted'}>{d.label}</Text>
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
                  subtitle={`${formatRelativeDay(s.createdAt)} · ${formatClock(s.durationMs)}`}
                  onPress={() => router.push({ pathname: '/workout/review/[id]', params: { id: s.id } })}
                  right={
                    <View style={styles.bestRight}>
                      <Text variant="body" tone="accent">{s.reps > 0 ? `${s.reps} reps` : `${s.holdSeconds}s`}</Text>
                      {s.score != null ? (
                        <Text variant="caption" style={{ color: formQualityColor(s.score) }}>{s.score} score</Text>
                      ) : null}
                    </View>
                  }
                />
              ))}
            </ListGroup>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function StatBox({
  label,
  value,
  icon,
  iconElement,
  tint,
}: {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Overrides `icon` with a custom element (e.g. the streak flame). */
  iconElement?: React.ReactNode;
  /** Color for the small tinted circle behind `icon` — a flat gray glyph
   * floating on its own read as an afterthought next to the streak flame's
   * glow, so every stat gets a matching colored "badge" backing instead. */
  tint?: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      {/* Fixed-height slot regardless of what's inside — the streak flame's
          glow varies in size with streak length (a 66px blaze vs a 48px dim
          flame) while the plain icon badges are a flat 30px, so without a
          shared slot every box's number/label landed at a different height. */}
      <View style={styles.statIconSlot}>
        {iconElement ??
          (icon ? (
            <View style={[styles.statIconBadge, { backgroundColor: `${tint ?? t.ink.muted}22` }]}>
              <Ionicons name={icon} size={15} color={tint ?? t.ink.muted} />
            </View>
          ) : null)}
      </View>
      <Text style={[styles.statValue, { color: t.ink.primary }]}>{value}</Text>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  );
}

/** The streak flame: a single asset, intensity conveyed by opacity/size/glow
 * instead of needing separate art per streak length. The "blazing" glow is a
 * true SVG radial gradient behind the flame — a native `shadow*` prop on the
 * Image would render a rectangular drop-shadow following the layer's square
 * bounding box (no shadowPath support in RN), which read as a hard-edged
 * "border" box around the flame instead of a soft aura, and couldn't be made
 * bigger without just blurring that same box further. */
function StreakFlame({ days }: { days: number }) {
  const lit = days > 0;
  const blazing = days >= 7;
  const size = blazing ? 17 : lit ? 15 : 13;
  // Fixed box (matches statIconSlot) instead of scaling with streak length —
  // a bigger glow made the icon read as the card's main event instead of the
  // number, which is the whole point of the stat.
  const box = 40;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {blazing ? (
        <Svg width={box} height={box} style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id="flameGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FF6A2E" stopOpacity={0.55} />
              <Stop offset="55%" stopColor="#FF6A2E" stopOpacity={0.2} />
              <Stop offset="100%" stopColor="#FF6A2E" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={box / 2} cy={box / 2} r={box / 2} fill="url(#flameGlow)" />
        </Svg>
      ) : null}
      <Image
        source={require('../../../assets/images/streak/flame.png')}
        style={{ width: size, height: size * 1.5, opacity: lit ? 1 : 0.3 }}
        resizeMode="contain"
      />
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
          style={{ height: 56, aspectRatio: BADGE_ASPECT[a.badge], opacity: a.unlocked ? 1 : 0.28 }}
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
    <View style={[styles.empty, { borderColor: t.ink.hairline }]}>
      <Ionicons name="stats-chart-outline" size={32} color={t.ink.muted} />
      <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.sm }}>
        Finish a workout and your stats will build here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, gap: 2 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  helpBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
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
  rankProgressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: Spacing.sm, width: '100%' },
  rankProgressFill: { height: '100%', borderRadius: 3 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  statBox: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statIconSlot: { height: 40, alignItems: 'center', justifyContent: 'center' },
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
  muscleCount: { width: 20, textAlign: 'right' },
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
  expandBadge: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
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
    borderStyle: 'dashed',
    alignItems: 'center',
  },
});
