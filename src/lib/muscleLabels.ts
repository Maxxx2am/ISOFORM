import type { Muscle } from '@/exercises/types';

/** Display label for each tracked muscle group — shared by Insights (muscle
 * focus widget) and Search (exercise row tags). */
export const MUSCLE_LABEL: Record<Muscle, string> = {
  quads: 'Quads',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
  chest: 'Chest',
  shoulders: 'Shoulders',
  triceps: 'Triceps',
  back: 'Back',
  biceps: 'Biceps',
  core: 'Core',
  forearms: 'Forearms',
  'hip flexors': 'Hip flexors',
};
