/**
 * Built-in training programs. Each program targets a goal exercise and
 * provides progressive steps through the exercise family. Steps gate on
 * rep count / hold time AND minimum form quality so you can't advance
 * with sloppy form.
 *
 * Programs use existing ISOFORM exercises only — no custom steps.
 * Form score range: 0 (all faults) to 100 (perfect).
 */

export interface ProgramStep {
  /** Exercise slug from the EXERCISES catalog. */
  exerciseSlug: string;
  /** What you need to achieve in one session before advancing. */
  requirement: {
    type: 'reps' | 'hold';
    /** Minimum rep count or hold seconds. */
    value: number;
    /** Minimum form quality score (0–100). Null = no minimum. */
    minFormScore: number | null;
  };
  /** One-line coaching note shown during this step. */
  tip: string;
}

export interface TrainingProgram {
  id: string;
  name: string;
  /** The goal exercise this program works toward. */
  goalSlug: string;
  description: string;
  /** Ordered progression steps. User starts at step 0. */
  steps: ProgramStep[];
}

export const PROGRAMS: TrainingProgram[] = [
  {
    id: 'planche-journey',
    name: 'Planche Journey',
    goalSlug: 'planche',
    description: 'From tuck to full planche. Master each progression before advancing.',
    steps: [
      { exerciseSlug: 'tuck-planche', requirement: { type: 'hold', value: 15, minFormScore: 80 }, tip: 'Focus on a tight tuck — knees to chest, back flat.' },
      { exerciseSlug: 'adv-tuck-planche', requirement: { type: 'hold', value: 10, minFormScore: 80 }, tip: 'Open your hips slightly — still tucked, but back starts to flatten.' },
      { exerciseSlug: 'straddle-planche', requirement: { type: 'hold', value: 5, minFormScore: 75 }, tip: 'Spread your legs wide — the straddle reduces leverage so you can focus on the lean.' },
      { exerciseSlug: 'planche', requirement: { type: 'hold', value: 3, minFormScore: 70 }, tip: 'Legs together, full extension. Even 3 clean seconds is elite.' },
    ],
  },
  {
    id: 'handstand-mastery',
    name: 'Handstand Mastery',
    goalSlug: 'handstand',
    description: 'Build a solid handstand from the wall to free-standing.',
    steps: [
      { exerciseSlug: 'wall-sit', requirement: { type: 'hold', value: 45, minFormScore: 80 }, tip: 'Build leg endurance and body awareness against a wall.' },
      { exerciseSlug: 'handstand', requirement: { type: 'hold', value: 20, minFormScore: 75 }, tip: 'Focus on a straight line — squeeze everything.' },
      { exerciseSlug: 'hespu', requirement: { type: 'reps', value: 3, minFormScore: 70 }, tip: 'Controlled descent — head to floor, press back up with straight body.' },
    ],
  },
  {
    id: 'front-lever-path',
    name: 'Front Lever Path',
    goalSlug: 'front-lever',
    description: 'Progress from tuck to full front lever with perfect horizontal holds.',
    steps: [
      { exerciseSlug: 'hanging-knee-raise', requirement: { type: 'reps', value: 10, minFormScore: 80 }, tip: 'Build hanging strength — controlled raises, no swinging.' },
      { exerciseSlug: 'tuck-front-lever', requirement: { type: 'hold', value: 15, minFormScore: 80 }, tip: 'Tight tuck — back horizontal, knees to chest.' },
      { exerciseSlug: 'adv-tuck-front-lever', requirement: { type: 'hold', value: 10, minFormScore: 75 }, tip: 'Open the tuck — hips and shoulders level.' },
      { exerciseSlug: 'front-lever', requirement: { type: 'hold', value: 5, minFormScore: 70 }, tip: 'Full extension. Even a few seconds is a milestone.' },
    ],
  },
  {
    id: 'push-up-mastery',
    name: 'Push-Up Mastery',
    goalSlug: 'pushup',
    description: 'Perfect your push-up — depth, form, and volume.',
    steps: [
      { exerciseSlug: 'plank', requirement: { type: 'hold', value: 60, minFormScore: 85 }, tip: 'Build core endurance — straight line, no sagging.' },
      { exerciseSlug: 'pushup', requirement: { type: 'reps', value: 20, minFormScore: 80 }, tip: 'Focus on full range — chest to floor, full lockout.' },
      { exerciseSlug: 'dip', requirement: { type: 'reps', value: 10, minFormScore: 75 }, tip: 'Add pressing strength — shoulders to elbow height, full lockout.' },
    ],
  },
  {
    id: 'core-foundation',
    name: 'Core Foundation',
    goalSlug: 'l-sit',
    description: 'Build the core strength needed for L-sits and beyond.',
    steps: [
      { exerciseSlug: 'plank', requirement: { type: 'hold', value: 45, minFormScore: 85 }, tip: 'Master the plank first — straight line, braced core.' },
      { exerciseSlug: 'leg-raise', requirement: { type: 'reps', value: 12, minFormScore: 80 }, tip: 'Controlled leg raises — no momentum, feel the compression.' },
      { exerciseSlug: 'hanging-knee-raise', requirement: { type: 'reps', value: 10, minFormScore: 80 }, tip: 'Hanging knee raises — knees above hips every rep.' },
      { exerciseSlug: 'l-sit', requirement: { type: 'hold', value: 10, minFormScore: 75 }, tip: 'Legs horizontal, arms locked. The real test of compression strength.' },
    ],
  },
];
