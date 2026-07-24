import type { L, Landmark } from '@/pose/types';

/** Per-frame values available to form rules. */
export type FormContext = {
  landmarks: Landmark[];
  /** Named angles produced by the exercise's `angles()` function. */
  angles: Record<string, number | null>;
};

export type CueSeverity = 'info' | 'warn';

/** A form check. `test` returns true when the rule is VIOLATED this frame. */
/** Body part a form rule targets — drives skeleton highlighting. */
export type BodyPart = 'torso' | 'arm' | 'leg';

export type FormRule = {
  id: string;
  /** Short imperative shown to the user, e.g. "Go lower". */
  cue: string;
  /** Fuller phrase the voice coach speaks (defaults to `cue`). */
  say?: string;
  severity: CueSeverity;
  /** Which body part this rule evaluates — used to color the skeleton overlay. */
  bodyPart?: BodyPart;
  test: (ctx: FormContext) => boolean;
};

/** Rep detection via one primary angle crossing two hysteresis thresholds. */
export type RepConfig = {
  angle: string;
  /** Angle must drop below this (contracted/bottom) … */
  downBelow: number;
  /** … then rise above this (extended/top) to complete one rep. */
  upAbove: number;
};

/** Isometric hold detection (e.g. plank): keep an angle inside a window. */
export type HoldConfig = {
  angle: string;
  minOk: number;
  maxOk: number;
};

/**
 * Attempt gate: while false, nothing counts. For holds it defines when the
 * clock runs (e.g. handstand must be inverted); for reps it splits the session
 * into attempts (e.g. HSPU reps only count while inverted, and the review keeps
 * the best consecutive streak).
 */
export type AttemptGate = (ctx: FormContext) => boolean;

export type ExerciseCategory = 'lower' | 'upper' | 'core' | 'full';
export type ExerciseMode = 'reps' | 'hold';

/**
 * Correct filming angle. 'side' = profile to the camera — form (arch, sag,
 * depth) is visible and only ONE side of the body needs to be seen; 'front' =
 * facing the camera — both arms/legs visible (push-ups, pull-ups, jacks).
 */
export type CameraView = 'front' | 'side';

/** Muscle groups used for the Insights "muscle focus" breakdown. */
export type Muscle =
  | 'quads'
  | 'glutes'
  | 'hamstrings'
  | 'calves'
  | 'chest'
  | 'shoulders'
  | 'triceps'
  | 'back'
  | 'biceps'
  | 'core'
  | 'forearms'
  | 'hip flexors';

export type Exercise = {
  id: string;
  slug: string;
  name: string;
  category: ExerciseCategory;
  mode: ExerciseMode;
  /** Whether live camera tracking is supported (has rep/hold config). */
  tracked: boolean;
  /** Progression family key (e.g. 'squat', 'pushup', 'pull'). */
  family: string;
  /** Difficulty within the family; next progression = same family, level + 1. */
  level: number;
  /** Primary muscles worked. */
  muscles: Muscle[];
  /** One-line description for cards. */
  summary: string;
  /** Ordered how-to steps for the learn screen. */
  howTo: string[];
  /** Static coaching tips shown while learning. */
  cues: string[];
  /** How to place the phone/body so tracking works (angle, distance, side). */
  setup?: string;
  /** Correct filming angle; drives the visibility gate (side = one side is enough). */
  view: CameraView;
  /** Draw only the upper body (arms + torso + head) in the skeleton — legs get
   * glitchy on movements where they're behind the body (e.g. front push-ups). */
  hideLegs?: boolean;
  /** Draw a horizontal line at the bar (wrist height) — for pull-ups. */
  showBar?: boolean;
  /** Landmarks that must be visible before tracking starts (full-body gate). */
  requiredJoints: L[];
  /** Primary angle target used for depth/ROM scoring in the review. */
  targetAngle?: number;
  /** Live form bar config: which angle to track and the zone thresholds. */
  gauge?: {
    angle: string;
    label: string;
    downBelow: number;
    upAbove: number;
    target: number;
  };
  /** Compute the named angles this exercise reasons about, for one frame. */
  angles: (lms: Landmark[]) => Record<string, number | null>;
  rep?: RepConfig;
  hold?: HoldConfig;
  /** While false nothing counts; splits reps/holds into attempts. */
  gate?: AttemptGate;
  /** Eccentric-only moves (negatives): credit a rep that reaches the bottom
   * even if the athlete bails instead of pressing back up. */
  countEccentric?: boolean;
  formRules: FormRule[];
};
