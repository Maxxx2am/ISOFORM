import type { Slug } from 'react-native-body-highlighter';

import type { Muscle } from '@/exercises/types';

/**
 * Maps this app's Muscle type to the slugs used by react-native-body-highlighter.
 * See the library's README for the full list of available slugs per side:
 * https://github.com/HichamELBSI/react-native-body-highlighter#list-of-body-parts
 *
 * Note: the library has no dedicated "hip flexors" slug. Front-facing hip
 * flexor work is visually closest to the adductors region, so that's used
 * as a stand-in. If that reads wrong in the UI, drop it and leave hip
 * flexors unmapped (it just won't highlight anything, which is also fine).
 */
export const muscleToFrontSlugs: Partial<Record<Muscle, Slug[]>> = {
  chest: ['chest'],
  shoulders: ['deltoids', 'trapezius'],
  triceps: ['triceps'],
  biceps: ['biceps'],
  core: ['abs', 'obliques'],
  quads: ['quadriceps'],
  calves: ['calves'],
  forearms: ['forearm'],
  'hip flexors': ['adductors'],
};

export const muscleToBackSlugs: Partial<Record<Muscle, Slug[]>> = {
  shoulders: ['deltoids', 'trapezius'],
  triceps: ['triceps'],
  back: ['upper-back', 'lower-back'],
  glutes: ['gluteal'],
  hamstrings: ['hamstring'],
  calves: ['calves'],
  forearms: ['forearm'],
};
