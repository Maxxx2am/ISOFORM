/** Aggregates workout history into the numbers shown on the Insights tab. */
import { getExercise, getNextProgression } from '@/exercises/data';
import type { Muscle } from '@/exercises/types';
import type { SessionRecord } from '@/storage/db';

export type PersonalBest = { exerciseId: string; exerciseName: string; mode: 'reps' | 'hold'; value: number };

/** All-time reps or hold-seconds for one exercise, summed across every session ever logged. */
export type LifetimeTotal = { exerciseId: string; exerciseName: string; mode: 'reps' | 'hold'; total: number };

/** An exercise whose most recent session scored well with real volume — a nudge to level up. */
export type ProgressionSuggestion = {
  exerciseId: string;
  exerciseName: string;
  nextSlug: string;
  nextName: string;
  score: number;
};

export type Insights = {
  totalSessions: number;
  weekSessions: number;
  streakDays: number;
  /** Total reps across all sessions in the last 7 days. */
  weekReps: number;
  /** Total hold seconds across all sessions in the last 7 days. */
  weekHoldSeconds: number;
  /** Session counts for the last 7 days, oldest → today (for the activity bars). */
  last7Days: { label: string; count: number }[];
  /** Total time trained across all sessions, ms. */
  totalTimeMs: number;
  /** Total reps across all sessions. */
  totalReps: number;
  muscleFocus: { muscle: Muscle; count: number }[];
  bests: PersonalBest[];
  /** Average form score (0-100) across sessions that have one, most recent first excluded. */
  avgScore: number | null;
  /** Last N session scores, oldest → newest, for a trend sparkline. */
  scoreTrend: { score: number; exerciseName: string }[];
  /** Exercises with distinct sessions trained (breadth of the library explored). */
  exercisesTrained: number;
  readyToProgress: ProgressionSuggestion[];
  /** All-time reps/seconds per exercise, biggest first — "how many pushups have I ever done". */
  lifetimeTotals: LifetimeTotal[];
};

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive days with a session, counting back from today or yesterday —
 * shared by the full Insights computation and any lighter-weight caller (e.g.
 * the Train tab header) that only has timestamps, not full session records. */
export function computeStreakDays(createdAts: number[], now: number = Date.now()): number {
  const days = new Set(createdAts.map(dayKey));
  let streakDays = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1); // allow "yesterday" start
  while (days.has(dayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streakDays;
}

export function computeInsights(sessions: SessionRecord[], now: number = Date.now()): Insights {
  const weekAgo = now - 7 * 86_400_000;
  const week = sessions.filter((s) => s.createdAt >= weekAgo);
  const weekSessions = week.length;
  const weekReps = week.reduce((sum, s) => sum + s.reps, 0);
  const weekHoldSeconds = week.reduce((sum, s) => sum + s.holdSeconds, 0);

  // Per-day activity, oldest → today.
  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const last7Days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const key = dayKey(d.getTime());
    last7Days.push({
      label: DAY_LETTERS[d.getDay()],
      count: sessions.filter((s) => dayKey(s.createdAt) === key).length,
    });
  }

  const streakDays = computeStreakDays(sessions.map((s) => s.createdAt), now);

  // Muscle focus.
  const muscleCount = new Map<Muscle, number>();
  for (const s of sessions) {
    const ex = getExercise(s.exerciseId);
    if (!ex) continue;
    for (const m of ex.muscles) muscleCount.set(m, (muscleCount.get(m) ?? 0) + 1);
  }
  const muscleFocus = [...muscleCount.entries()]
    .map(([muscle, count]) => ({ muscle, count }))
    .sort((a, b) => b.count - a.count);

  // Personal bests per exercise (max reps, or max hold seconds).
  const bestMap = new Map<string, PersonalBest>();
  for (const s of sessions) {
    const mode: 'reps' | 'hold' = s.reps > 0 ? 'reps' : 'hold';
    const value = mode === 'reps' ? s.reps : s.holdSeconds;
    if (value <= 0) continue;
    // Keyed by exerciseId, not name, to match every other aggregation in
    // this file (and lib/rank.ts) — two different exercises reusing a
    // display name would otherwise silently merge their PB records.
    const cur = bestMap.get(s.exerciseId);
    if (!cur || value > cur.value)
      bestMap.set(s.exerciseId, { exerciseId: s.exerciseId, exerciseName: s.exerciseName, mode, value });
  }
  const bests = [...bestMap.values()].sort((a, b) => b.value - a.value);

  // Prefer activeMs (sum of every attempt's duration, rest excluded) — falls
  // back to durationMs (wall-clock, includes rest) only for rows saved before
  // activeMs existed.
  const totalTimeMs = sessions.reduce((sum, x) => sum + (x.activeMs ?? x.durationMs), 0);
  const totalReps = sessions.reduce((sum, x) => sum + x.reps, 0);

  const scored = sessions.filter((s) => s.score != null) as (SessionRecord & { score: number })[];
  const avgScore = scored.length ? Math.round(mean(scored.map((s) => s.score))) : null;
  // Sessions are DESC by createdAt; take the most recent 10 and flip to oldest→newest for the trend.
  const scoreTrend = scored
    .slice(0, 10)
    .reverse()
    .map((s) => ({ score: s.score, exerciseName: s.exerciseName }));

  const exercisesTrained = new Set(sessions.map((s) => s.exerciseId)).size;

  // Ready-to-progress: the most recent session per exercise, if it scored well
  // with real volume and a next progression in the same family exists.
  const latestByExercise = new Map<string, SessionRecord>();
  for (const s of sessions) {
    if (!latestByExercise.has(s.exerciseId)) latestByExercise.set(s.exerciseId, s);
  }
  const readyToProgress: ProgressionSuggestion[] = [];
  for (const s of latestByExercise.values()) {
    if (s.score == null || s.score < 72) continue;
    const hasVolume = s.reps >= 8 || s.holdSeconds >= 15;
    if (!hasVolume) continue;
    const ex = getExercise(s.exerciseId);
    const next = ex ? getNextProgression(ex) : undefined;
    if (!ex || !next) continue;
    readyToProgress.push({ exerciseId: ex.id, exerciseName: ex.name, nextSlug: next.slug, nextName: next.name, score: s.score });
  }
  readyToProgress.sort((a, b) => b.score - a.score);

  // Lifetime totals: every rep and every hold-second ever logged, per exercise —
  // summed across ALL history, not just one session or one day.
  const totalsMap = new Map<string, { exerciseId: string; exerciseName: string; reps: number; holdSeconds: number }>();
  for (const s of sessions) {
    const cur = totalsMap.get(s.exerciseId) ?? { exerciseId: s.exerciseId, exerciseName: s.exerciseName, reps: 0, holdSeconds: 0 };
    cur.reps += s.reps;
    cur.holdSeconds += s.holdSeconds;
    totalsMap.set(s.exerciseId, cur);
  }
  const lifetimeTotals: LifetimeTotal[] = [...totalsMap.values()]
    .map((x) => {
      const ex = getExercise(x.exerciseId);
      const mode: 'reps' | 'hold' = ex?.mode ?? (x.reps >= x.holdSeconds ? 'reps' : 'hold');
      return { exerciseId: x.exerciseId, exerciseName: x.exerciseName, mode, total: mode === 'reps' ? x.reps : x.holdSeconds };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    totalTimeMs,
    totalReps,
    totalSessions: sessions.length,
    weekSessions,
    streakDays,
    weekReps,
    weekHoldSeconds,
    last7Days,
    muscleFocus,
    bests,
    avgScore,
    scoreTrend,
    exercisesTrained,
    readyToProgress,
    lifetimeTotals,
  };
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** The best-scoring past session for one exercise (for the "your best run" replay). */
export function bestSessionFor(exerciseId: string, sessions: SessionRecord[]): SessionRecord | null {
  const mine = sessions.filter((s) => s.exerciseId === exerciseId);
  if (mine.length === 0) return null;
  return mine.reduce((best, s) => {
    const v = s.reps > 0 ? s.reps : s.holdSeconds;
    const bv = best.reps > 0 ? best.reps : best.holdSeconds;
    return v > bv ? s : best;
  });
}
