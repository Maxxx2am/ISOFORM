/** A handful of ready-made workout templates so "Choose template" isn't empty
 * on a fresh install — same shape as a user-saved `SavedWorkout`'s steps, just
 * never persisted (built fresh each time it's started, via the ad-hoc draft
 * store — see `workout/templates.tsx`). */
import type { WorkoutStep } from '@/store/workouts';

export type BuiltinTemplate = { name: string; steps: WorkoutStep[] };

function step(exerciseSlug: string, goal: WorkoutStep['goal']): WorkoutStep {
  return { id: `${exerciseSlug}-builtin`, exerciseSlug, goal };
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'Full-Body Beginner',
    steps: [
      step('pushup', { type: 'reps', values: [10] }),
      step('squat', { type: 'reps', values: [15] }),
      step('wall-sit', { type: 'hold', values: [20] }),
      step('plank', { type: 'hold', values: [20] }),
    ],
  },
  {
    name: 'Push / Pull',
    steps: [
      step('pushup', { type: 'reps', values: [12] }),
      step('pullup', { type: 'reps', values: [5] }),
      step('dip', { type: 'reps', values: [10] }),
    ],
  },
  {
    name: 'Core Circuit',
    steps: [
      step('l-sit', { type: 'hold', values: [10] }),
      step('plank', { type: 'hold', values: [30] }),
      step('superman-hold', { type: 'hold', values: [20] }),
      step('hanging-knee-raise', { type: 'reps', values: [10] }),
    ],
  },
  {
    name: 'Cardio Burst',
    steps: [
      step('jumping-jack', { type: 'reps', values: [30] }),
      step('mountain-climbers', { type: 'reps', values: [20] }),
      step('jump-squat', { type: 'reps', values: [15] }),
    ],
  },
];
