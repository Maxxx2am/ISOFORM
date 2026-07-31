/**
 * Estimates a calisthenics "rank" tier per exercise from your best reps/hold
 * time. IMPORTANT: there's no population/scientific dataset available
 * on-device — thresholds below are hand-picked from widely-cited calisthenics
 * community benchmarks (e.g. "20 pull-ups ≈ elite"), not a validated fitness
 * assessment. Treat it as a fun estimate, not a certification.
 */
import type { ImageSourcePropType } from 'react-native';

import { getExercise } from '@/exercises/data';
import type { Sex } from '@/store/profile';
import type { SessionRecord } from '@/storage/db';

/** 3 metals × 4 sub-levels each — a long, grindable ladder rather than 5 flat bands. */
export const RANK_TIERS = [
  'Bronze I', 'Bronze II', 'Bronze III', 'Bronze IV',
  'Silver I', 'Silver II', 'Silver III', 'Silver IV',
  'Gold I', 'Gold II', 'Gold III', 'Gold IV',
] as const;
export type RankTier = (typeof RANK_TIERS)[number];

const TIER_COUNT = RANK_TIERS.length; // 12
const METAL_COLOR: Record<'Bronze' | 'Silver' | 'Gold', string> = {
  Bronze: '#E0793E',
  Silver: '#AEB9C4',
  Gold: '#FFC13D',
};

export function rankColor(tier: RankTier): string {
  return METAL_COLOR[tier.split(' ')[0] as 'Bronze' | 'Silver' | 'Gold'];
}

/**
 * Width/height of each sliced icon file — the hexagon "badge" itself is the
 * same real size within each metal (bronze/silver/gold), only the width
 * grows as higher levels add wings/stars/ribbons around it. Rendering at a
 * fixed HEIGHT with this aspect ratio (instead of squeezing every icon into
 * the same square box) keeps the hexagon visually consistent across levels —
 * a level IV badge just extends wider, it never shrinks the core badge.
 */
export const RANK_ICON_ASPECT: Record<RankTier, number> = {
  'Bronze I': 201 / 234,
  'Bronze II': 201 / 234,
  'Bronze III': 201 / 234,
  'Bronze IV': 280 / 234,
  'Silver I': 201 / 234,
  'Silver II': 203 / 234,
  'Silver III': 283 / 234,
  'Silver IV': 279 / 234,
  'Gold I': 283 / 273,
  'Gold II': 310 / 273,
  'Gold III': 340 / 273,
  'Gold IV': 329 / 273,
};

/** Icon for each of the 12 tiers, sliced from the user's own bronze/silver/gold badge pack. */
export const RANK_ICONS: Record<RankTier, ImageSourcePropType> = {
  'Bronze I': require('../../assets/images/ranks/bronze-1.png'),
  'Bronze II': require('../../assets/images/ranks/bronze-2.png'),
  'Bronze III': require('../../assets/images/ranks/bronze-3.png'),
  'Bronze IV': require('../../assets/images/ranks/bronze-4.png'),
  'Silver I': require('../../assets/images/ranks/silver-1.png'),
  'Silver II': require('../../assets/images/ranks/silver-2.png'),
  'Silver III': require('../../assets/images/ranks/silver-3.png'),
  'Silver IV': require('../../assets/images/ranks/silver-4.png'),
  'Gold I': require('../../assets/images/ranks/gold-1.png'),
  'Gold II': require('../../assets/images/ranks/gold-2.png'),
  'Gold III': require('../../assets/images/ranks/gold-3.png'),
  'Gold IV': require('../../assets/images/ranks/gold-4.png'),
};

export type ExerciseRank = {
  exerciseId: string;
  exerciseName: string;
  mode: 'reps' | 'hold';
  value: number;
  tier: RankTier;
  tierIndex: number; // 0 (Bronze I) .. 11 (Gold IV)
  /** 0..1 progress from this tier's floor toward the next tier (1 at max tier). */
  progressToNext: number;
  /** Raw value still needed to reach the next tier, or null if already at Gold IV. */
  remainingToNext: number | null;
  nextTier: RankTier | null;
};

/**
 * 11 boundaries (round multipliers of a single "elite" anchor value) carving
 * the scale into 12 tiers. Bronze/Silver climb evenly to Gold I sitting right
 * at the widely-cited "you've made it" number (20 pull-ups, 50 push-ups, a
 * 120s handstand, etc.) — from there Gold is a different game entirely: II is
 * 1.5x that, III is 3x, and Gold IV is a full 5x the number most people
 * consider "elite" (e.g. 100 pull-ups, 250 push-ups). Round multipliers are
 * used deliberately so thresholds land on clean numbers (50, 100, 250) for
 * round anchors instead of odd values like 96.
 */
const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5, 3.0, 5.0];

/** Hand-authored "elite" anchor per iconic movement — one well-known number
 * each, easier to trust than 11 made-up intermediate ones. */
const ELITE_ANCHOR: Record<string, number> = {
  pushup: 50,
  pullup: 20,
  squat: 70,
  dip: 35,
  handstand: 120,
  'l-sit': 60,
  plank: 240,
  pistol: 20,
  hespu: 20,
  'muscle-up': 12,
  'front-lever': 40,
  planche: 40,
  'wall-sit': 240,
  'hanging-knee-raise': 35,
};

const GENERIC_ANCHOR: Record<'reps' | 'hold', number> = { reps: 40, hold: 120 };

/** Every other tracked exercise falls back here, scaled by its own
 * progression `level` — a harder variant of a family needs less volume to
 * reach the same tier as an easier one. */
function eliteAnchorFor(exercise: { slug: string; mode: 'reps' | 'hold'; level: number }): number {
  const known = ELITE_ANCHOR[exercise.slug];
  if (known != null) return known;
  const base = GENERIC_ANCHOR[exercise.mode];
  const difficulty = 0.6 + 0.4 * Math.min(3, exercise.level);
  return Math.max(1, Math.round(base / difficulty));
}

function thresholdsFor(eliteAnchor: number): number[] {
  return FRACTIONS.map((f) => Math.max(1, Math.round(f * eliteAnchor)));
}

/** Heavier bodyweight makes a bodyweight rep/hold harder — modest ±30% swing centered on 70kg. */
function bodyweightFactor(weightKg: number | null): number {
  if (weightKg == null) return 1;
  const f = 1 + 0.3 * (weightKg - 70) / 70;
  return Math.min(1.3, Math.max(0.75, f));
}

/** Longer limbs/torso make full-body holds and levers harder (bigger lever
 * arm) — only applied to those categories, height doesn't meaningfully
 * change a squat or push-up rep. Modest ±15% swing centered on 170cm. */
function leverageFactor(heightCm: number | null, category: string): number {
  if (heightCm == null) return 1;
  if (category !== 'full' && category !== 'core') return 1;
  const f = 1 + 0.15 * (heightCm - 170) / 170;
  return Math.min(1.15, Math.max(0.9, f));
}

/** Clean reps count more than sloppy ones at the same raw number. */
function formFactor(score: number | null): number {
  return 0.7 + 0.3 * ((score ?? 100) / 100);
}

/**
 * Modest, optional adjustment: the community "elite" numbers these anchors
 * come from (20 pull-ups, etc.) are typically quoted without reference to
 * who's doing them, but tend in practice to reflect average male performance
 * more than female. A ~15% credit keeps the SAME tier thresholds fair to
 * compare against rather than requiring an identical absolute number.
 * "Prefer not to say" (the default) applies no adjustment either way.
 */
function sexFactor(sex: Sex | null | undefined): number {
  return sex === 'female' ? 1 / 0.85 : 1;
}

/**
 * Modest, optional, and capped: most bodyweight-strength standards treat
 * roughly 18-40 as one band, then get gradually more forgiving beyond that —
 * mirrors how age-graded fitness/running tables work. No adjustment below 40
 * or when age isn't given.
 */
function ageFactor(age: number | null): number {
  if (age == null || age <= 40) return 1;
  const over = Math.min(30, age - 40); // caps the leniency growth at 70+
  return 1 + 0.01 * over;
}

/**
 * Full 12-tier requirement table for one exercise, personalized by the same
 * body-stat/sex/age factors as `computeRanks` (assuming clean form, since
 * form varies set-to-set and isn't a fixed trait to plan around). Powers the
 * "?" breakdown — "how many reps for EACH rank", not just the next one.
 */
export function tierRequirements(
  exercise: { slug: string; mode: 'reps' | 'hold'; level: number; category: string },
  profile: { heightCm: number | null; weightKg: number | null; sex?: Sex | null; age?: number | null },
): { tier: RankTier; value: number }[] {
  const thresholds = thresholdsFor(eliteAnchorFor(exercise));
  const combined =
    bodyweightFactor(profile.weightKg) *
    leverageFactor(profile.heightCm, exercise.category) *
    formFactor(100) *
    sexFactor(profile.sex) *
    ageFactor(profile.age ?? null);

  const rows: { tier: RankTier; value: number }[] = [{ tier: RANK_TIERS[0], value: 0 }];
  thresholds.forEach((th, i) => rows.push({ tier: RANK_TIERS[i + 1], value: Math.max(1, Math.round(th / combined)) }));
  return rows;
}

/** Shared by computeRanks (per-session history) and rankForValue (one ad-hoc
 * number, for the "check a rank" tool) — everything past "here's the
 * effective value" is identical. */
function tierFromEffective(
  effective: number,
  thresholds: number[],
): Pick<ExerciseRank, 'tierIndex' | 'progressToNext' | 'remainingToNext' | 'nextTier'> {
  let idx = -1;
  for (let i = 0; i < thresholds.length; i++) {
    if (effective >= thresholds[i]) idx = i;
  }
  const tierIndex = Math.max(0, Math.min(TIER_COUNT - 1, idx + 1));
  const floor = idx >= 0 ? thresholds[idx] : 0;
  const nextThreshold = thresholds[idx + 1];
  const progressToNext = nextThreshold != null && nextThreshold > floor
    ? Math.min(1, Math.max(0, (effective - floor) / (nextThreshold - floor)))
    : 1;
  return {
    tierIndex,
    progressToNext,
    remainingToNext: nextThreshold != null ? Math.max(0, Math.ceil(nextThreshold - effective)) : null,
    nextTier: tierIndex + 1 < TIER_COUNT ? RANK_TIERS[tierIndex + 1] : null,
  };
}

export function computeRanks(
  sessions: SessionRecord[],
  profile: { heightCm: number | null; weightKg: number | null; sex?: Sex | null; age?: number | null },
): ExerciseRank[] {
  const bestMap = new Map<string, { exerciseId: string; exerciseName: string; mode: 'reps' | 'hold'; value: number; score: number | null }>();
  for (const s of sessions) {
    const mode: 'reps' | 'hold' = s.reps > 0 ? 'reps' : 'hold';
    const value = mode === 'reps' ? s.reps : s.holdSeconds;
    if (value <= 0) continue;
    const cur = bestMap.get(s.exerciseId);
    if (!cur || value > cur.value) bestMap.set(s.exerciseId, { exerciseId: s.exerciseId, exerciseName: s.exerciseName, mode, value, score: s.score });
  }

  const ranks: ExerciseRank[] = [];
  for (const b of bestMap.values()) {
    const ex = getExercise(b.exerciseId);
    if (!ex) continue;
    const thresholds = thresholdsFor(eliteAnchorFor(ex));
    const effective =
      b.value *
      bodyweightFactor(profile.weightKg) *
      leverageFactor(profile.heightCm, ex.category) *
      formFactor(b.score) *
      sexFactor(profile.sex) *
      ageFactor(profile.age ?? null);

    const tiered = tierFromEffective(effective, thresholds);
    ranks.push({
      exerciseId: b.exerciseId,
      exerciseName: b.exerciseName,
      mode: b.mode,
      value: b.value,
      tier: RANK_TIERS[tiered.tierIndex],
      ...tiered,
    });
  }

  return ranks.sort((a, b) => b.tierIndex - a.tierIndex || b.progressToNext - a.progressToNext);
}

/**
 * Computes a rank from one ad-hoc reps/hold-seconds number instead of your
 * own tracked history — the "check someone's rank" tool: enter their stats
 * and a claimed number, get the same tier a real tracked set would produce.
 * Assumes clean form (score 100), same as `tierRequirements`.
 */
export function rankForValue(
  exercise: { slug: string; mode: 'reps' | 'hold'; level: number; category: string },
  value: number,
  profile: { heightCm: number | null; weightKg: number | null; sex?: Sex | null; age?: number | null },
): Omit<ExerciseRank, 'exerciseId' | 'exerciseName'> {
  const thresholds = thresholdsFor(eliteAnchorFor(exercise));
  const effective =
    value *
    bodyweightFactor(profile.weightKg) *
    leverageFactor(profile.heightCm, exercise.category) *
    formFactor(100) *
    sexFactor(profile.sex) *
    ageFactor(profile.age ?? null);

  const tiered = tierFromEffective(effective, thresholds);
  return { mode: exercise.mode, value, tier: RANK_TIERS[tiered.tierIndex], ...tiered };
}
