import type { Exercise } from '@/exercises/types';

type GeneratedStep = {
  exerciseSlug: string;
  exerciseName: string;
  goal: { type: 'reps' | 'hold'; values: number[] };
};

/**
 * Quick workout generator: given a target time (minutes) and the full exercise
 * catalog, returns a balanced circuit targeting different muscle groups.
 * Shorter times → fewer exercises, lower targets. Never more than 5 exercises.
 */
export function generateQuickWorkout(timeMin: number, exercises: Exercise[]): GeneratedStep[] {
  const tracked = exercises.filter((e) => e.tracked);
  const byCategory = {
    upper: tracked.filter((e) => e.category === 'upper'),
    lower: tracked.filter((e) => e.category === 'lower'),
    core: tracked.filter((e) => e.category === 'core'),
    full: tracked.filter((e) => e.category === 'full'),
  };

  const pick = (pool: Exercise[]): Exercise => pool[Math.floor(Math.random() * pool.length)];

  // For reps exercises, estimate ~3s per rep including rest between.
  // For holds, one rep = one second of hold time. Rough but good enough.
  const countForTime = (mode: 'reps' | 'hold', share: number) => {
    if (mode === 'hold') return Math.max(5, Math.round(share));
    return Math.max(8, Math.round(share / 3));
  };

  let count: number;
  let groups: (keyof typeof byCategory)[];
  if (timeMin <= 5) {
    count = 2;
    groups = ['upper', 'lower'];
  } else if (timeMin <= 10) {
    count = 3;
    groups = ['upper', 'lower', 'core'];
  } else if (timeMin <= 15) {
    count = 4;
    groups = ['upper', 'lower', 'core', 'full'];
  } else {
    count = 5;
    groups = ['lower', 'upper', 'core', 'full', 'core'];
  }

  const steps: GeneratedStep[] = [];
  const used = new Set<string>();
  const share = (timeMin * 60) / count;

  for (let i = 0; i < count; i++) {
    const group = groups[i];
    const pool = byCategory[group].filter((e) => !used.has(e.id));
    if (pool.length === 0) continue;
    const ex = pick(pool);
    used.add(ex.id);
    const goal = {
      type: ex.mode ?? 'reps',
      values: [countForTime(ex.mode ?? 'reps', share)],
    };
    steps.push({ exerciseSlug: ex.slug, exerciseName: ex.name, goal: goal as GeneratedStep['goal'] });
  }

  return steps;
}
