/**
 * Daily challenge system.
 *
 * FREE users: Push-up challenges Mon/Wed/Fri. Other days = no card shown.
 *   - If the user has never done push-ups: time-based only ("max in 1 min").
 *   - Once they have sessions: adaptive rep targets (never below 10).
 *
 * PAID users: Every day. Rotates through 5 simple exercises.
 *   - Week 1 (no data): time-based challenges.
 *   - Week 2+: adaptive targets mixed with time challenges.
 *
 * All targets are based on the user's personal best — scaled up slightly
 * so every day is achievable but pushes you a bit further.
 */

import type { SessionRecord } from '@/storage/db';
import { getExercise } from '@/exercises/data';

export type ChallengeMode =
  | 'max-time'   // Most reps in 1 minute
  | 'max-hold'   // Longest hold in one set
  | 'best-form'  // Highest form quality
  | 'rep-target' // Hit X clean reps (adaptive)
  | 'hold-target'; // Hold X seconds (adaptive)

export interface DailyChallenge {
  id: string;
  date: string;
  mode: ChallengeMode;
  exerciseSlug: string;
  exerciseName: string;
  title: string;
  subtitle: string;
  target: number | null; // null = no specific target (time/endurance based)
  targetLabel: string;
  minimum: number;
  minimumLabel: string;
}

/** Exercises that rotate for paid users (simple, accessible moves). */
const PAID_POOL = ['pushup', 'squat', 'plank', 'jumping-jack', 'mountain-climbers'];

const MODES: { mode: ChallengeMode; title: string; label: string }[] = [
  { mode: 'max-time', title: 'Max reps in 1 min', label: 'reps' },
  { mode: 'max-hold', title: 'Longest hold', label: 'sec' },
  { mode: 'best-form', title: 'Best form quality', label: 'score' },
  { mode: 'rep-target', title: 'Hit the target', label: 'reps' },
  { mode: 'hold-target', title: 'Hold the target', label: 'sec' },
];

function dayIndex(date: Date): number {
  const start = new Date(2026, 0, 1).getTime();
  return Math.floor((date.getTime() - start) / 86_400_000);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function seedFrom(index: number): number {
  let s = Math.abs(index);
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b);
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
  return (s ^ (s >>> 16)) >>> 0;
}

/** How many unique days the user has at least one session for. */
function uniqueTrainingDays(sessions: SessionRecord[]): number {
  const days = new Set(sessions.map((s) => new Date(s.createdAt).toISOString().slice(0, 10)));
  return days.size;
}

function bestFor(exerciseSlug: string, sessions: SessionRecord[]): SessionRecord | undefined {
  let best: SessionRecord | undefined;
  for (const s of sessions) {
    if (s.exerciseId !== exerciseSlug) continue;
    if (!best || (s.reps > best.reps) || (s.holdSeconds > best.holdSeconds)) best = s;
  }
  return best;
}

function computeRepTarget(best?: SessionRecord): number | null {
  const bestReps = best?.reps ?? 0;
  if (bestReps <= 0) return null;
  return Math.max(10, Math.ceil(bestReps * 1.15));
}

function computeHoldTarget(best?: SessionRecord): number | null {
  const bestHold = best?.holdSeconds ?? 0;
  if (bestHold <= 0) return null;
  return Math.max(10, Math.ceil(bestHold * 1.15));
}

export function getDailyChallenge(
  date: Date,
  sessions: SessionRecord[],
  hasAllAccess: boolean,
): DailyChallenge | null {
  const idx = dayIndex(date);
  const seed = seedFrom(idx);
  const dow = date.getDay();
  const isFreeDay = dow === 1 || dow === 3 || dow === 5; // Mon/Wed/Fri
  const trainingDays = uniqueTrainingDays(sessions);
  const isNew = trainingDays < 3; // No real history yet — use time-based

  // Free user, not a push-up day → no challenge
  if (!hasAllAccess && !isFreeDay) return null;

  // Pick exercise
  let exerciseSlug: string;
  if (!hasAllAccess) {
    exerciseSlug = 'pushup';
  } else {
    exerciseSlug = PAID_POOL[(seed >>> 4) % PAID_POOL.length];
  }

  const best = bestFor(exerciseSlug, sessions);
  const exerciseMode = getExercise(exerciseSlug)?.mode;
  const modeIdx = idx % MODES.length;
  let mode = MODES[modeIdx];

  // Never pair a hold challenge with a rep exercise (or vice versa). The old
  // rotation produced nonsense such as "Hold the target · Push-Up".
  if (exerciseMode === 'hold' && mode.mode !== 'max-hold' && mode.mode !== 'hold-target' && mode.mode !== 'best-form') {
    mode = MODES[1];
  } else if (exerciseMode === 'reps' && (mode.mode === 'max-hold' || mode.mode === 'hold-target')) {
    mode = MODES[0];
  }

  // Override: new users or no data → time/endurance modes only
  if (isNew && (mode.mode === 'rep-target' || mode.mode === 'hold-target')) {
    mode = exerciseSlug === 'plank' ? MODES[1] : MODES[0]; // max-hold for plank, max-time for others
  }

  // Compute target
  let target: number | null = null;
  switch (mode.mode) {
    case 'rep-target':
      target = computeRepTarget(best);
      if (target == null) target = 10; // fallback minimum
      break;
    case 'hold-target':
      target = computeHoldTarget(best);
      if (target == null) target = 15;
      break;
    case 'max-time':
    case 'max-hold':
    case 'best-form':
      target = null; // time-based = no specific target
      break;
  }

  const minimum = target ?? (
    mode.mode === 'max-time' ? 60
    : mode.mode === 'best-form' ? (exerciseMode === 'hold' ? 10 : 5)
    : mode.mode === 'max-hold' ? 10
    : 0
  );
  const minimumLabel = target != null
    ? mode.label
    : mode.mode === 'max-time' || mode.mode === 'max-hold' || exerciseMode === 'hold'
      ? 'seconds'
      : 'reps';

  return {
    id: `challenge-${idx}`,
    date: date.toISOString().slice(0, 10),
    mode: mode.mode,
    exerciseSlug,
    exerciseName: exerciseSlug,
    title: mode.title,
    subtitle: target != null ? `Target: ${target}${mode.label}` : 'Do your best',
    target,
    targetLabel: mode.label,
    minimum,
    minimumLabel,
  };
}

/**
 * Score a completed session against the daily challenge.
 * Returns null if no sessions match. Score 0-100+.
 */
export function scoreChallenge(
  challenge: DailyChallenge,
  sessions: SessionRecord[],
): number | null {
  const today = todayString();
  const todaySessions = sessions.filter(
    (s) => new Date(s.createdAt).toISOString().slice(0, 10) === today
      && s.exerciseId === challenge.exerciseSlug,
  );
  if (todaySessions.length === 0) return null;

  const bestReps = Math.max(...todaySessions.map((s) => s.reps));
  const bestHold = Math.max(...todaySessions.map((s) => s.holdSeconds));
  const formAvg = todaySessions.reduce((a, s) => a + (s.score ?? 70), 0) / todaySessions.length;

  switch (challenge.mode) {
    case 'max-time':
      return Math.round(bestReps * (formAvg / 100));
    case 'max-hold':
      return Math.round(bestHold * (formAvg / 100));
    case 'best-form':
      return Math.round(Math.max(...todaySessions.map((s) => s.score ?? 70)));
    case 'rep-target': {
      const total = todaySessions.reduce((a, s) => a + s.reps, 0);
      const onTarget = challenge.target != null && total >= challenge.target;
      return Math.round((onTarget ? 100 : challenge.target ? (total / challenge.target) * 100 : bestReps) * (formAvg / 100));
    }
    case 'hold-target': {
      const total = todaySessions.reduce((a, s) => a + s.holdSeconds, 0);
      const onTarget = challenge.target != null && total >= challenge.target;
      return Math.round(onTarget ? 100 : challenge.target ? (total / challenge.target) * 100 : bestHold);
    }
  }
}

/** A saved result is only complete when it belongs to today's challenge and
 * actually satisfies that challenge's minimum. Older builds could persist a
 * zero-value result, so the home card must not trust history blindly. */
export function isChallengeComplete(challenge: DailyChallenge, result: { challengeId: string; bestReps: number; totalReps?: number; durationSeconds?: number; bestHoldSeconds: number }): boolean {
  if (result.challengeId !== challenge.id) return false;
  if (challenge.mode === 'max-time') return (result.durationSeconds ?? 0) >= challenge.minimum;
  const value = challenge.mode === 'max-hold' || challenge.mode === 'hold-target'
    ? result.bestHoldSeconds
    : result.bestReps;
  return value >= challenge.minimum;
}

const MOTIVATION = [
  'That was solid — come back tomorrow.',
  'Progress is slow, then sudden. Keep showing up.',
  'One rep closer to where you want to be.',
  "Consistency beats intensity. You're building the habit.",
  'Good work. The version of you in 3 months will thank you.',
  'Small wins compound. This was one of them.',
  "You showed up. That's the hardest part done.",
  "Day by day, rep by rep — you're getting stronger.",
  'Rest well, come back hungry tomorrow.',
  'The only bad workout is the one you skipped.',
  'Form > speed. Depth > ego. You got this.',
  "You're already ahead of everyone still on the couch.",
  'That rep count is climbing. Keep feeding it.',
  'Your future self is watching. Make them proud.',
  'Strength is earned in the reps nobody sees. We saw these.',
  'No shortcuts. Just work. You did the work.',
  'Every session is a deposit in the strength bank.',
  "Don't compare to others. Compare to yesterday. You're winning.",
  'The grind pays off. Trust the process.',
  'Form is looking sharp. Keep chasing perfect reps.',
  'You pushed through. That mental edge matters more than muscle.',
  "Tomorrow's challenge is already waiting. Rest up.",
  'Respect the rest day. Growth happens when you recover.',
  'Clean reps today, more reps tomorrow.',
  "You're building more than muscle — you're building discipline.",
  'The first 10 seconds of a hold are the hardest. You passed that.',
  'Stay humble, stay hungry, stay consistent.',
  "Numbers don't lie. Yours are moving up.",
  'This is how champions are made — one set at a time.',
  'Finish strong. Then come back and finish stronger.',
];

export function getMotivation(seed: number): string {
  return MOTIVATION[seed % MOTIVATION.length];
}
