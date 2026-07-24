import { allVisible, jointAngle, segmentAngle, symmetricAngle } from '@/engine/angles';
import type { Landmark } from '@/pose/types';
import { L } from '@/pose/types';
import type { Exercise, ExerciseCategory, ExerciseMode, Muscle } from '@/exercises/types';

function verticalDeviation(a: Landmark, b: Landmark): number | null {
  if ((a?.visibility ?? 0) < 0.5 || (b?.visibility ?? 0) < 0.5) return null;
  return Math.abs(Math.abs(segmentAngle(a, b)) - 90);
}

/** y of a left/right pair using whichever side(s) the camera can see. */
function pairY(lms: Landmark[], l: L, r: L, mode: 'avg' | 'min' = 'avg'): number | null {
  const pts = [lms[l], lms[r]].filter((p) => (p?.visibility ?? 0) >= 0.5);
  if (pts.length === 0) return null;
  if (mode === 'min') return Math.min(...pts.map((p) => p.y));
  return pts.reduce((s, p) => s + p.y, 0) / pts.length;
}

/**
 * Clearly upside-down (side view, one visible side is enough): feet AND hips
 * above the shoulders — two independent signals, so standing can never pass.
 */
function isInverted(lms: Landmark[]): boolean {
  const ankle = pairY(lms, L.LeftAnkle, L.RightAnkle, 'min');
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  if (ankle == null || hip == null || shoulder == null) return false;
  return ankle < shoulder - 0.06 && hip < shoulder - 0.02;
}

/**
 * Ground-work gate (push-ups): "confirmed on the floor". Standing puts the hips
 * FAR below the shoulders on screen; on the floor they're at similar heights.
 * Can't see the hips → nothing counts (walking to the camera hides them).
 * This ONLY decides "are you doing this move at all" — form quality (sagging,
 * piking, depth) is judged separately by formRules/hold windows so a scruffy
 * rep still gets scanned and coached instead of silently not counting.
 */
function isProne(lms: Landmark[]): boolean {
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  if (hip == null || shoulder == null) return false;
  return hip - shoulder < 0.3;
}

/** Pike posture: hips at or above shoulder height (standing puts them well below). */
function isPiked(lms: Landmark[]): boolean {
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  if (hip == null || shoulder == null) return false;
  return hip < shoulder + 0.16;
}

/** On the bar: both wrists clearly above the shoulders (hanging). */
function isHangingOnBar(lms: Landmark[]): boolean {
  const wrist = pairY(lms, L.LeftWrist, L.RightWrist, 'min');
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  if (wrist == null || shoulder == null) return false;
  return wrist < shoulder - 0.08;
}

/** Feet off the floor (L-sit): ankles above the hands. */
function feetOffFloor(lms: Landmark[], margin = 0.02): boolean {
  const handY = pairY(lms, L.LeftWrist, L.RightWrist);
  const footY = pairY(lms, L.LeftAnkle, L.RightAnkle, 'min') ?? pairY(lms, L.LeftKnee, L.RightKnee, 'min');
  if (handY == null || footY == null) return false;
  return footY < handY - margin;
}

const STANDING = [L.LeftShoulder, L.RightShoulder, L.LeftHip, L.RightHip, L.LeftKnee, L.RightKnee, L.LeftAnkle, L.RightAnkle];
const ARMS = [L.LeftShoulder, L.RightShoulder, L.LeftElbow, L.RightElbow];
const ARMS_AND_HIPS = [L.LeftShoulder, L.RightShoulder, L.LeftElbow, L.RightElbow, L.LeftHip, L.RightHip];

const ELBOW = (lms: Landmark[]) => ({
  elbow: symmetricAngle(lms, [L.LeftShoulder, L.LeftElbow, L.LeftWrist], [L.RightShoulder, L.RightElbow, L.RightWrist]),
});
const KNEE = (lms: Landmark[]) => ({
  knee: symmetricAngle(lms, [L.LeftHip, L.LeftKnee, L.LeftAnkle], [L.RightHip, L.RightKnee, L.RightAnkle]),
});
const HIP = (lms: Landmark[]) => ({
  hip: symmetricAngle(lms, [L.LeftShoulder, L.LeftHip, L.LeftKnee], [L.RightShoulder, L.RightHip, L.RightKnee]),
});
const BODYLINE = (lms: Landmark[]) => ({
  bodyLine: symmetricAngle(lms, [L.LeftShoulder, L.LeftHip, L.LeftAnkle], [L.RightShoulder, L.RightHip, L.RightAnkle]),
});
const ELBOW_AND_BODYLINE = (lms: Landmark[]) => ({ ...ELBOW(lms), ...BODYLINE(lms) });
const HIP_AND_KNEE = (lms: Landmark[]) => ({ ...HIP(lms), ...KNEE(lms) });

const PUSH_REP = { angle: 'elbow', downBelow: 95, upAbove: 155 } as const;
const PULL_REP = { angle: 'elbow', downBelow: 95, upAbove: 145 } as const;

/** Hands on the floor: wrists low in frame (side view ground contact). */
function handsOnFloor(lms: Landmark[]): boolean {
  const wrist = pairY(lms, L.LeftWrist, L.RightWrist, 'min');
  return wrist != null && wrist > 0.6;
}

/** Body roughly horizontal (side view): shoulders and hips at similar y. */
function isHorizontal(lms: Landmark[], margin = 0.18): boolean {
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  if (hip == null || shoulder == null) return false;
  return Math.abs(hip - shoulder) < margin;
}

/** Planche gate: hands on floor + body roughly horizontal + knees/feet off the floor. */
function isInPlanche(lms: Landmark[]): boolean {
  if (!handsOnFloor(lms) || !isHorizontal(lms)) return false;
  const knee = pairY(lms, L.LeftKnee, L.RightKnee, 'min');
  const wrist = pairY(lms, L.LeftWrist, L.RightWrist, 'min');
  if (knee == null || wrist == null) return false;
  return knee < wrist - 0.04; // knees above wrists = floating
}

/** One-leg-forward gate for pistol squat: one ankle well above the other. */
function oneLegForward(lms: Landmark[]): boolean {
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (!la || !ra) return false;
  if (la.visibility < 0.5 || ra.visibility < 0.5) return false;
  return Math.abs(la.y - ra.y) > 0.08;
}

/**
 * Feet planted side-by-side, not mid-stride: from a SIDE camera, a real
 * two-footed squat stance keeps both ankles at nearly the same on-screen x
 * (they're stacked front-to-back along the camera's depth axis). Walking
 * toward/away from the camera swings one leg forward each step, which
 * separates the ankles in x — and that stride, not a real squat, was what
 * was tripping the knee angle through the rep thresholds and counting a
 * phantom rep while the user got into position.
 */
function feetPlanted(lms: Landmark[], marginX = 0.15): boolean {
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (!la || !ra) return false;
  if (la.visibility < 0.5 || ra.visibility < 0.5) return false;
  return Math.abs(la.x - ra.x) < marginX;
}

/** Hands close together (front view) — for diamond push-up vs regular push-up. */
function handsTogether(lms: Landmark[]): boolean {
  const lw = lms[L.LeftWrist]; const rw = lms[L.RightWrist];
  if (!lw || !rw) return false;
  if (lw.visibility < 0.5 || rw.visibility < 0.5) return false;
  return Math.abs(lw.x - rw.x) < 0.12;
}

/** Cross-back below the bar (muscle-up transition negative): shoulders below wrists after coming over. */
function belowBar(lms: Landmark[]): boolean {
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  const wrist = pairY(lms, L.LeftWrist, L.RightWrist);
  if (shoulder == null || wrist == null) return false;
  return shoulder > wrist + 0.05;
}

const ELBOW_HIP = (lms: Landmark[]) => ({ ...ELBOW(lms), ...HIP(lms) });

/** Track the MORE BENT knee (min of both) — for single-leg moves like pistol. */
function minKnee(lms: Landmark[]): number | null {
  const lOk = allVisible(lms, [L.LeftHip, L.LeftKnee, L.LeftAnkle], 0.5);
  const rOk = allVisible(lms, [L.RightHip, L.RightKnee, L.RightAnkle], 0.5);
  const lAng = lOk ? jointAngle(lms[L.LeftHip], lms[L.LeftKnee], lms[L.LeftAnkle]) : null;
  const rAng = rOk ? jointAngle(lms[L.RightHip], lms[L.RightKnee], lms[L.RightAnkle]) : null;
  if (lAng != null && rAng != null) return Math.min(lAng, rAng);
  return lAng ?? rAng;
}
const MIN_KNEE = (lms: Landmark[]) => ({ knee: minKnee(lms) });
const ELBOW_HIP_BODY = (lms: Landmark[]) => ({ ...ELBOW(lms), ...HIP(lms), ...BODYLINE(lms) });

/** Track the MORE DRAWN-IN hip (min of both) — for alternating-leg drills
 * (mountain climbers, high knees) where either leg's drive should count. */
function minHip(lms: Landmark[]): number | null {
  const lOk = allVisible(lms, [L.LeftShoulder, L.LeftHip, L.LeftKnee], 0.5);
  const rOk = allVisible(lms, [L.RightShoulder, L.RightHip, L.RightKnee], 0.5);
  const lAng = lOk ? jointAngle(lms[L.LeftShoulder], lms[L.LeftHip], lms[L.LeftKnee]) : null;
  const rAng = rOk ? jointAngle(lms[L.RightShoulder], lms[L.RightHip], lms[L.RightKnee]) : null;
  if (lAng != null && rAng != null) return Math.min(lAng, rAng);
  return lAng ?? rAng;
}
const MIN_HIP = (lms: Landmark[]) => ({ hip: minHip(lms) });

/**
 * Pseudo-angle for jumping jacks: arms at your sides reads high (like a rep
 * exercise's resting "top"), arms overhead reads low ("bottom") — so it slots
 * into the same rep-counter hysteresis as every other move. Unverified on
 * device (new heuristic, no real joint this measures) — the scale may need
 * a real-world pass once it's actually tried on a phone.
 */
function jackAngle(lms: Landmark[]): number | null {
  const wrist = pairY(lms, L.LeftWrist, L.RightWrist);
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  if (wrist == null || shoulder == null || hip == null) return null;
  const span = Math.max(0.05, hip - shoulder);
  const raw = (wrist - shoulder) / span; // >0 wrists below shoulders (arms down), <0 above (overhead)
  return Math.max(0, Math.min(180, 90 + raw * 90));
}
const JACK_ANGLE = (lms: Landmark[]) => ({ jack: jackAngle(lms) });

/**
 * How high the hips have risen above the shoulder-ankle line, as a 0-180
 * pseudo-angle (90 = resting flat, higher = more lift). Glute bridges were
 * originally tracked with the HIP() joint angle (shoulder-hip-knee) like
 * every other hinge move, but that angle also shifts with how far your feet
 * are planted from your hips — a setup choice, not form — so two people (or
 * the same person on different reps) could show very different "depth"
 * readings despite lifting the exact same height. Measuring the hip's
 * vertical position directly sidesteps foot placement entirely. Unverified
 * on device — new heuristic, the scale factor may need a real-world pass.
 */
function hipLift(lms: Landmark[]): number | null {
  const shoulder = pairY(lms, L.LeftShoulder, L.RightShoulder);
  const hip = pairY(lms, L.LeftHip, L.RightHip);
  const ankle = pairY(lms, L.LeftAnkle, L.RightAnkle);
  if (shoulder == null || hip == null || ankle == null) return null;
  const baseline = (shoulder + ankle) / 2;
  const lift = baseline - hip; // positive once the hips rise above the shoulder-ankle line
  return Math.max(0, Math.min(180, 90 + lift * 400));
}
const HIP_LIFT = (lms: Landmark[]) => ({ hip: hipLift(lms) });


type Def = {
  slug: string; name: string; category: ExerciseCategory; mode: ExerciseMode;
  family: string; level: number; muscles: Muscle[]; summary: string; howTo: string[]; cues: string[];
  view?: Exercise['view']; setup?: string; hideLegs?: boolean; showBar?: boolean;
  angles?: Exercise['angles']; rep?: Exercise['rep']; hold?: Exercise['hold'];
  gauge?: Exercise['gauge'];
  gate?: Exercise['gate']; requiredJoints?: Exercise['requiredJoints']; targetAngle?: number;
  countEccentric?: Exercise['countEccentric'];
  formRules?: Exercise['formRules'];
};

function def(p: Def): Exercise {
  const tracked = !!(p.rep || p.hold);
  return {
    id: p.slug,
    tracked,
    view: p.view ?? 'side',
    requiredJoints: p.requiredJoints ?? (tracked ? STANDING : []),
    angles: p.angles ?? (() => ({})),
    formRules: p.formRules ?? [],
    ...p,
  } as Exercise;
}

/** ISOFORM's tracked calisthenics library. Every gate below only decides "are
 * you doing this move at all" — bad form (sagging, piking, shallow depth,
 * flared elbows...) never stops a rep or hold from being scanned; it only
 * changes the score and the cue you get coached on. */
export const EXERCISES: Exercise[] = [
  def({
    slug: 'pushup', name: 'Push-Up', category: 'upper', mode: 'reps', family: 'push', level: 1,
    muscles: ['chest', 'triceps', 'shoulders'], view: 'front', requiredJoints: ARMS, hideLegs: true,
    setup: 'FACE the camera: phone on the floor propped up, ~1.5 m in front of your head. It reads your hands, arms and head.',
    summary: 'Upper-body press. Lower your chest, push the floor away.',
    howTo: ['Hands under shoulders, body in a line.', 'Brace core and squeeze glutes.', 'Lower until elbows reach ~90°.', 'Press up without letting hips sag.'],
    cues: [
      'Elbows track ~45° from your torso, not flared to 90°',
      'One straight line from head to heels — brace like you\'re about to be poked',
      'Full lockout at the top — don\'t rest, don\'t cut it short',
      'Hands roughly under your shoulders, not out wide',
      'Break parallel: get your chest within a fist of the floor',
      'Exhale as you press up, inhale on the way down',
      'Squeeze your glutes and quads to stop your hips sagging',
      'Keep your neck neutral — eyes on the floor just ahead of your hands',
      'Spread your fingers and grip the floor for shoulder stability',
      'Slow the descent (2–3s) instead of dropping — control builds more strength',
      'If your lower back aches, your hips are probably sagging — brace your core first',
      'Plateaued? Elevate your feet slightly to add load before harder variations',
    ],
    angles: ELBOW_AND_BODYLINE, rep: PUSH_REP, targetAngle: 90, gate: ({ landmarks }) => isProne(landmarks),
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 95, upAbove: 155, target: 90 },
    formRules: [
      { id: 'body-line', bodyPart: 'torso', cue: 'Straighten your body', say: 'Keep your body in one straight line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 160 },
      { id: 'depth', bodyPart: 'arm', cue: 'Go a little lower', say: 'Go a little lower — get your elbows to ninety.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      { id: 'sagging-hips', bodyPart: 'torso', cue: 'Don\'t let your hips sag', say: 'Your hips are dropping — squeeze your glutes to keep a straight line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 140 },
      { id: 'elbow-flare', bodyPart: 'arm', cue: 'Tuck your elbows in', say: 'Keep your elbows at a 45-degree angle to your torso, not flared out.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const le = landmarks[L.LeftElbow]; const lw = landmarks[L.LeftWrist];
          return ls != null && le != null && lw != null && ls.visibility >= 0.5 && le.visibility >= 0.5 && lw.visibility >= 0.5
            ? Math.abs(le.x - ls.x) > Math.abs(lw.x - le.x) * 1.5 : false;
      }},
    ],
  }),
  def({
    slug: 'pullup', name: 'Pull-Up', category: 'upper', mode: 'reps', family: 'pull', level: 1,
    muscles: ['back', 'biceps'], view: 'front', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'FACE the camera from the bar, phone upright 2–3 m away. It marks the bar and watches your chin rise to it. Whole body in frame.',
    summary: 'Back and biceps pull. Chin over the bar, full hang.',
    howTo: ['Hang from the bar, hands just outside shoulders.', 'Pull your elbows down and back.', 'Bring your chin over the bar.', 'Lower all the way to a full hang.'],
    cues: [
      'Full dead hang at the bottom every rep — don\'t short the range',
      'Pull your elbows down and back, not just up',
      'Lead with your chest, not your chin',
      'Keep your legs still — no kipping or swinging',
      'Squeeze your shoulder blades together before you pull',
      'Grip just outside shoulder width for a balanced pull',
      'Exhale hard on the way up, control the negative down',
      'Engage your lats first — think "pull the bar to me," not "pull me to the bar"',
      'Can\'t get a rep clean? Do slow negatives instead of kipping',
      'Keep your core braced so your legs don\'t swing forward',
      'Chin clears the bar, not just close to it',
      'Rest 2–3 minutes between sets — pull-ups are neurologically demanding',
    ],
    angles: ELBOW, rep: PULL_REP, targetAngle: 55,
    gauge: { angle: 'elbow', label: 'Height', downBelow: 95, upAbove: 145, target: 55 },
    formRules: [
      { id: 'partial', bodyPart: 'arm', cue: 'Chin over the bar', say: 'Pull higher — get your chin over the bar.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow > 95 && angles.elbow < 130 },
      { id: 'no-lockout', bodyPart: 'arm', cue: 'Lock out at the bottom', say: 'Fully extend your arms at the bottom — dead hang every rep.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'kipping', bodyPart: 'torso', cue: 'No kipping', say: 'Use strict form — no swinging your legs or hips to gain momentum.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (!ls || !rs || !lh || !rh) return false;
          if (ls.visibility < 0.5 || rs.visibility < 0.5 || lh.visibility < 0.5 || rh.visibility < 0.5) return false;
          const shoulderY = (ls.y + rs.y) / 2;
          const hipY = (lh.y + rh.y) / 2;
          return Math.abs(shoulderY - hipY) > 0.15;
      }},
    ],
  }),
  def({
    slug: 'l-sit', name: 'L-Sit', category: 'core', mode: 'hold', family: 'l-sit', level: 1,
    muscles: ['core', 'triceps'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => feetOffFloor(landmarks, 0),
    setup: 'Film your SIDE at floor level. It watches one arm, your torso and one leg — the L of your hips and whether your legs are straight and floating.',
    summary: 'Support hold with legs extended straight — compression strength.',
    howTo: ['Hands on the floor or parallettes.', 'Press down and lift your body.', 'Extend legs to horizontal, feet off the floor.', 'Hold with straight knees.'],
    cues: [
      'Push the floor away — shoulders down, not up by your ears',
      'Point your toes and squeeze your quads for a longer-looking line',
      'Lean your torso slightly forward to unload your hip flexors',
      'Keep your knees locked straight, not softly bent',
      'Breathe shallow and steady — don\'t hold your breath',
      'Press your palms flat, fingers spread, wrists under shoulders',
      'Practice tucked knees first if straight legs collapse your hips',
      'Keep your gaze forward, not down at your feet',
      'Hollow your body — ribs down, don\'t let your back arch',
      'Short, frequent holds beat one long ugly one — quality over duration',
      'Parallettes raise you off the floor for extra clearance if space is tight',
      'Hip flexors burning first is normal — that\'s not a sign you\'re doing it wrong',
    ],
    angles: HIP_AND_KNEE, hold: { angle: 'hip', minOk: 20, maxOk: 165 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Straightness', downBelow: 120, upAbove: 160, target: 180 },
    formRules: [
      { id: 'bent-legs', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Straighten your legs — lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Depress your shoulders', say: 'Push your shoulders down away from your ears — don\'t shrug.', severity: 'warn', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? (ls.y - nose.y) < 0.08 : false;
      }},
    ],
  }),
  def({
    slug: 'plank', name: 'Forearm Plank', category: 'core', mode: 'hold', family: 'plank', level: 1,
    muscles: ['core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isProne(landmarks),
    setup: 'Film your SIDE at floor level. It watches one side — shoulder, hip and ankle — so your body line is clear.',
    summary: 'Anti-extension core hold. Stay flat and braced.',
    howTo: ['Forearms under your shoulders.', 'Extend legs, feet hip-width.', 'One straight line head to heels.', 'Brace your abs and breathe.'],
    cues: [
      'One straight line from head to heels — imagine a rod down your spine',
      'Squeeze your glutes hard — it takes the load off your lower back',
      'Brace your abs like you\'re about to be poked in the stomach',
      'Neutral neck — gaze at the floor, not straight ahead',
      'Elbows stacked directly under your shoulders',
      'Don\'t let your hips pike up to make it easier — that\'s cheating the hold',
      'Push the floor away through your forearms to protect your shoulders',
      'Keep breathing steadily — holding your breath fatigues you faster',
      'Feet hip-width apart for a stable base',
      'Quads engaged, knees locked, no sagging at the knees',
      'If your lower back aches, stop — that means your hips have dropped',
      'Build time gradually — add 5–10s per week rather than chasing a max hold',
    ],
    angles: BODYLINE, hold: { angle: 'bodyLine', minOk: 130, maxOk: 180 }, targetAngle: 178,
    formRules: [
      { id: 'sag', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze your glutes and lift them into line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 158 },
      { id: 'piked', bodyPart: 'torso', cue: 'Lower your hips', say: 'You\'re piking up — bring your hips down in line with your shoulders and heels.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine > 175 },
      { id: 'neutral-neck', bodyPart: 'torso', cue: 'Neutral neck', say: 'Keep your neck in line with your spine — gaze at the floor, not ahead.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
    ],
  }),
  def({
    slug: 'squat', name: 'Bodyweight Squat', category: 'lower', mode: 'reps', family: 'squat', level: 1,
    muscles: ['quads', 'glutes'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => feetPlanted(landmarks),
    setup: 'Film your SIDE, phone upright 2–3 m away — head to feet in frame. It watches one leg and your back.',
    summary: 'The foundational leg exercise. Sit down, stand tall.',
    howTo: ['Feet shoulder-width, toes slightly out.', 'Brace your core, chest proud.', 'Push hips back, bend knees to ~parallel.', 'Drive through mid-foot to stand tall.'],
    cues: [
      'Weight through your heels and midfoot, not your toes',
      'Push your hips back first, like sitting into a chair',
      'Chest up and proud — don\'t let your torso collapse forward',
      'Knees track in line with your toes, don\'t let them cave inward',
      'Go to at least parallel — a shallow squat skips the hardest range',
      'Drive up through the middle of your foot, not your toes',
      'Keep your core braced throughout, not just at the bottom',
      'Inhale on the way down, exhale as you drive up',
      'Full stand at the top — lock your hips out, don\'t stop short',
      'Control the descent — don\'t just drop into the hole',
      'Heels flat on the floor the whole rep — don\'t let them lift',
      'If your knees ache, check they aren\'t collapsing inward first',
    ],
    angles: (lms) => ({ ...KNEE(lms), torsoLean: verticalDeviation(lms[L.LeftShoulder], lms[L.LeftHip]) }),
    rep: { angle: 'knee', downBelow: 112, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 112, upAbove: 155, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Go lower — get your thighs to parallel.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 120 && angles.knee < 150 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest up and eyes forward.', severity: 'warn', test: ({ angles }) => angles.torsoLean != null && angles.knee != null && angles.knee < 150 && angles.torsoLean > 45 },
      { id: 'knee-track', bodyPart: 'leg', cue: 'Knees over toes', say: 'Track your knees in line with your toes — don\'t let them cave in.', severity: 'warn', test: ({ landmarks }) => {
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (!lk || !rk || !la || !ra) return false;
          if (lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return (Math.abs(lk.x - la.x) > 0.08 || Math.abs(rk.x - ra.x) > 0.08);
      }},
    ],
  }),
  def({
    slug: 'dip', name: 'Dip', category: 'upper', mode: 'reps', family: 'dip', level: 1,
    muscles: ['chest', 'triceps', 'shoulders'], view: 'side', requiredJoints: ARMS,
    setup: 'Film your SIDE at bar/chair height so your elbow bend and depth are visible.',
    summary: 'The essential vertical push. Lower to 90°, press to lockout.',
    howTo: ['Support yourself on bars, arms straight.', 'Slight forward lean.', 'Lower until shoulders reach elbow height.', 'Press back to a full lockout.'],
    cues: [
      'Shoulders down and back, away from your ears',
      'Lean forward slightly to bias your chest, stay upright for triceps',
      'Lower until your shoulders reach elbow height — full depth',
      'Elbows tucked close, not flared out to the sides',
      'Full lockout at the top every rep',
      'Control the descent — don\'t just drop and bounce out of the bottom',
      'Keep your core tight so your legs don\'t swing',
      'Exhale as you press up out of the bottom',
      'If your shoulders pinch, reduce depth until mobility improves',
      'Grip the bars firmly, wrists straight, not bent back',
      'Warm up your shoulders before going for depth',
      'Add a slow 3–4s lowering phase to build serious pressing strength',
    ],
    angles: ELBOW, rep: { angle: 'elbow', downBelow: 118, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 118, upAbove: 155, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Go a little deeper — shoulders to elbow height.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      { id: 'lean-forward', bodyPart: 'torso', cue: 'Lean forward slightly', say: 'A slight forward lean targets your chest — don\'t stay upright.', severity: 'info', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const lh = landmarks[L.LeftHip];
          return ls != null && lh != null && ls.visibility >= 0.5 && lh.visibility >= 0.5
            ? Math.abs(ls.x - lh.x) < 0.03 : false;
      }},
    ],
  }),
  def({
    slug: 'pike-pushup', name: 'Pike Push-Up', category: 'upper', mode: 'reps', family: 'pike', level: 1,
    muscles: ['shoulders', 'triceps'], view: 'side', requiredJoints: ARMS_AND_HIPS,
    gate: ({ landmarks }) => isPiked(landmarks),
    setup: 'Film your SIDE so the pike (hips high) and your bending arms are visible.',
    summary: 'The shoulder press — your path to handstand push-ups. Hips high, lower your head.',
    howTo: ['Downward-dog pike, hips high.', 'Hands shoulder-width, head between your arms.', 'Bend elbows to lower toward the floor.', 'Press back to a straight-arm pike.'],
    cues: [
      'Hips stay high, in an inverted-V the whole set',
      'Head aims for a spot just in front of your hands, not straight down',
      'Elbows track forward and slightly out, not straight back',
      'Full press to a straight-arm pike at the top',
      'Walk your feet closer to your hands for a steeper, harder angle',
      'Keep your core braced so your hips don\'t sag as you fatigue',
      'Exhale as you press away from the floor',
      'This builds toward handstand push-ups — treat it as a strength builder',
      'Elevate your feet on a box to increase the incline and difficulty',
      'Control the lowering phase — don\'t let gravity do all the work',
      'Keep your neck relaxed — don\'t crane it to look forward',
      'If your wrists ache, spread your fingers wide and grip the floor',
    ],
    angles: ELBOW, rep: { angle: 'elbow', downBelow: 118, upAbove: 145 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 118, upAbove: 145, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Lower your head closer to the floor — aim for a 90° elbow bend.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      { id: 'hips-dropping', bodyPart: 'torso', cue: 'Keep hips high', say: 'Your hips are dropping — keep them stacked above your shoulders.', severity: 'warn', test: ({ landmarks }) => {
          const lh = landmarks[L.LeftHip]; const ls = landmarks[L.LeftShoulder];
          return lh != null && ls != null && lh.visibility >= 0.5 && ls.visibility >= 0.5
            ? (lh.y - ls.y) > 0.15 : false;
      }},
    ],
  }),
  def({
    slug: 'handstand', name: 'Handstand', category: 'full', mode: 'hold', family: 'handstand', level: 1,
    muscles: ['shoulders', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInverted(landmarks),
    setup: 'Film your SIDE from 3–4 m, phone upright. The side view shows your arch — only one arm and one leg need to be visible.',
    summary: 'Inverted balance. Stack a straight line over your hands.',
    howTo: ['Start in a lunge, hands planted.', 'Kick up, stack hips over shoulders over hands.', 'Point toes, squeeze tight.', 'Hold the line.'],
    cues: [
      'Stack hips directly over your shoulders, over your hands',
      'Squeeze your glutes and ribs down to kill the banana back',
      'Gaze between your hands, not back toward your feet',
      'Spread your fingers wide and grip the floor for micro-balance',
      'Point your toes and squeeze your legs together',
      'Push the floor away through straight arms — don\'t let your shoulders collapse',
      'Practice against a wall first to remove the fear of falling',
      'Fall out safely by cartwheeling or walking your hands back — don\'t force it',
      'Kick up with control, not a wild swing — a slow kick is easier to catch',
      'Little finger and toe adjustments are normal — stillness comes with practice',
      'Breathe — don\'t hold your breath while balancing',
      'A few short daily holds beat one long weekly session',
    ],
    angles: (lms) => ({ ...BODYLINE(lms), ...KNEE(lms), lean: verticalDeviation(lms[L.LeftShoulder], lms[L.LeftHip]) }),
    hold: { angle: 'bodyLine', minOk: 45, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Straightness', downBelow: 120, upAbove: 160, target: 178 },
    formRules: [
      // Live-only nudge; it never affects the score (holds score on straightness).
      // Only call an "arch" when the knees are straight — bent knees also drop
      // the body line, but that's a tuck, not a banana.
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten — squeeze your line', say: 'You are arching your back. Flex your abs and squeeze your legs together.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 160 && angles.knee != null && angles.knee > 140 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten and squeeze your legs', say: 'Point your toes and squeeze your legs together — no bent knees.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 140 },
      { id: 'gaze', bodyPart: 'torso', cue: 'Gaze between your hands', say: 'Look between your hands — don\'t look back at the floor.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw) return false;
          if (nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.1;
      }},
    ],
  }),
  // ───────── Planche path (side view, holds) ─────────
  def({
    slug: 'tuck-planche', name: 'Tuck Planche', category: 'full', mode: 'hold', family: 'planche', level: 1,
    muscles: ['shoulders', 'core', 'chest'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInPlanche(landmarks),
    setup: 'Film your SIDE from 2–3 m, phone upright. Hands on the floor, body horizontal — it reads one arm and torso.',
    summary: 'Planche progression with knees pulled tight to your chest.',
    howTo: ['Place hands on floor, lean forward until shoulders are past hands.', 'Pull knees to your chest, feet off the floor.', 'Lock your arms, squeeze your back.', 'Hold the tuck — body parallel to the floor.'],
    cues: [
      'Lock your elbows completely — bent arms turn this into a plank',
      'Lean your shoulders well past your hands before lifting your feet',
      'Pull your knees tight to your chest for the easiest lever',
      'Keep your back flat — don\'t let your hips pike up',
      'Protract your shoulder blades — round your upper back slightly, don\'t arch',
      'Feet fully off the floor, not just skimming it',
      'Squeeze your abs hard to keep the tuck compact',
      'Practice planche leans first to build shoulder-lean tolerance',
      'Wrists take real load here — warm them up with circles and stretches first',
      'Hold time matters less than a clean shape — don\'t sacrifice form for seconds',
      'Keep your neck neutral, gaze slightly forward of your hands',
      'Rest fully between attempts — this is a max-effort strength hold',
    ],
    angles: ELBOW_HIP_BODY, hold: { angle: 'hip', minOk: 0, maxOk: 110 }, targetAngle: 50,
    gauge: { angle: 'hip', label: 'Tuck', downBelow: 20, upAbove: 80, target: 50 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Fully extend your elbows — straight arms.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'feet-up', cue: 'Lift your feet', say: 'Pull your feet off the floor — float.', severity: 'info', test: ({ landmarks }) => {
          const a = pairY(landmarks, L.LeftAnkle, L.RightAnkle, 'min');
          const w = pairY(landmarks, L.LeftWrist, L.RightWrist);
          return a == null || w == null || a > w - 0.02;
      }},
      { id: 'tuck-tight', bodyPart: 'leg', cue: 'Pull knees tighter', say: 'Squeeze your knees closer to your chest.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 75 && angles.hip < 100 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Don\'t pike — keep your back flat and parallel to the floor.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 140 },
    ],
  }),
  def({
    slug: 'adv-tuck-planche', name: 'Advanced Tuck Planche', category: 'full', mode: 'hold', family: 'planche', level: 2,
    muscles: ['shoulders', 'core', 'chest'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInPlanche(landmarks),
    setup: 'Film your SIDE from 2–3 m. Same setup as Tuck Planche but your hips are more open.',
    summary: 'Tuck planche with hips pulled back — opening toward full planche.',
    howTo: ['Start in a tuck planche.', 'Slowly extend your hips back, keeping feet off the floor.', 'Knees stay bent but hips open wider.', 'Hold with arms locked and back flat.'],
    cues: [
      'Open your hips further back than a basic tuck, knees still bent',
      'Arms fully locked, no exceptions — non-negotiable at this level',
      'Keep your back flat and ribs down — don\'t let your hips sag or pike',
      'Feet stay off the floor throughout the entire hold',
      'Shoulders protracted and leaned well past your hands',
      'Breathe steadily — tension everywhere except your face',
      'Lose the shape after a couple seconds? Regress to tuck planche and rebuild',
      'Warm up wrists and shoulders thoroughly before attempting',
      'Progress the hip angle gradually — small opens over weeks, not all at once',
      'Keep your gaze fixed just ahead of your hands for balance',
      'Quality over quantity — a clean 5s beats a sloppy 15s',
      'Train this 2–3x a week max — it\'s taxing on the shoulders and wrists',
    ],
    angles: ELBOW_HIP_BODY, hold: { angle: 'hip', minOk: 65, maxOk: 150 }, targetAngle: 110,
    gauge: { angle: 'hip', label: 'Open', downBelow: 80, upAbove: 135, target: 110 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Fully extend your elbows — straight arms.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Keep your back flat — don\'t sag or pike.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 140 },
      { id: 'feet-up', cue: 'Don\'t touch the floor', say: 'Keep your feet off the floor.', severity: 'info', test: ({ landmarks }) => {
          const a = pairY(landmarks, L.LeftAnkle, L.RightAnkle, 'min');
          const w = pairY(landmarks, L.LeftWrist, L.RightWrist);
          return a == null || w == null || a > w - 0.02;
      }},
    ],
  }),
  def({
    slug: 'planche', name: 'Planche', category: 'full', mode: 'hold', family: 'planche', level: 3,
    muscles: ['shoulders', 'core', 'chest', 'back'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInPlanche(landmarks),
    setup: 'Film your SIDE from 2–3 m. Full planche — body horizontal with straight legs.',
    summary: 'Ultimate static hold. Body parallel to the floor on straight arms.',
    howTo: ['Lean forward past your hands with straight arms.', 'Squeeze your entire body.', 'Lift your legs to horizontal, toes pointed.', 'Hold — every muscle tight.'],
    cues: [
      'Body parallel to the floor, dead straight from shoulders to toes',
      'Arms locked completely straight — no bend at all',
      'Point your toes and squeeze your legs together',
      'Ribs pulled down, back flat — don\'t let your hips sag or pike',
      'Shoulders protracted, leaning well past your hands',
      'Grip the floor hard, fingers spread for stability',
      'This is an elite strength hold — a few clean seconds is a real achievement',
      'Warm up shoulders and wrists thoroughly — the load here is significant',
      'Hips dropping is fatigue setting in — end the set cleanly',
      'Keep breathing — don\'t lock your breath while straining',
      'Build through the tuck and straddle progressions rather than rushing here',
      'Rest 2–3 minutes between attempts — this is a max-strength skill',
    ],
    angles: ELBOW_HIP_BODY, hold: { angle: 'bodyLine', minOk: 125, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'hip', label: 'Extension', downBelow: 20, upAbove: 80, target: 50 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Straight arms — don\'t bend your elbows.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Point your toes and squeeze your legs together.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Keep your back flat and parallel to the floor.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
      { id: 'hips-low', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze your glutes to lift.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 145 },
    ],
  }),
  // ───────── Front Lever path (side view, holds, bar) ─────────
  def({
    slug: 'tuck-front-lever', name: 'Tuck Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 1,
    muscles: ['back', 'core', 'biceps'], view: 'side', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'Film your SIDE from 2–3 m. Hanging from the bar, knees tucked to your chest.',
    summary: 'Front lever progression. Hang and hold your knees to your chest, body level.',
    howTo: ['Hang from the bar with straight arms.', 'Pull your knees to your chest.', 'Rotate your back so your shoulders are roughly level with your hips.', 'Hold the tuck, breathing steadily.'],
    cues: [
      'Arms locked straight — the work happens at your shoulders and back, not your elbows',
      'Pull your knees tight to your chest for the easiest tuck',
      'Rotate your shoulders so your body is roughly level, not hanging straight down',
      'Squeeze your shoulder blades down and back',
      'Keep your chin slightly tucked, not craned up',
      'Grip the bar just outside shoulder width',
      'Breathe steadily — don\'t hold your breath mid-hold',
      'Practice tuck front lever rows first if the static hold is too hard',
      'Warm up your shoulders and elbows — levers load them heavily',
      'A shaky 5s is progress — don\'t chase time before the shape is right',
      'Keep your core braced so your hips don\'t sag below your shoulders',
      'Rest fully between attempts — this is a strength skill, not conditioning',
    ],
    angles: ELBOW_HIP, hold: { angle: 'hip', minOk: 5, maxOk: 90 }, targetAngle: 40,
    gauge: { angle: 'hip', label: 'Tuck', downBelow: 20, upAbove: 65, target: 40 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Keep your arms fully locked — no bending.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'tuck-tighter', bodyPart: 'leg', cue: 'Pull knees tighter', say: 'Pull your knees closer to your chest.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 70 },
      { id: 'hips-dropping', bodyPart: 'torso', cue: 'Level your hips', say: 'Lift your hips — your body should be horizontal.', severity: 'warn', test: ({ landmarks }) => {
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          return h != null && s != null && (h - s) > 0.12;
      }},
    ],
  }),
  def({
    slug: 'adv-tuck-front-lever', name: 'Advanced Tuck Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 2,
    muscles: ['back', 'core', 'biceps'], view: 'side', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'Film your SIDE. Hanging from the bar with knees extended further back than tuck.',
    summary: 'Front lever progression. Hips open more, knees pulled back toward the bar.',
    howTo: ['Hang from the bar with straight arms.', 'Pull your knees up but extend them back behind you.', 'Rotate your body horizontal.', 'Hold — back flat, arms straight.'],
    cues: [
      'Extend your knees back further than a basic tuck while keeping them bent',
      'Arms straight throughout — no elbow bend',
      'Body horizontal — hips level with your shoulders',
      'Squeeze your glutes and lats to hold the line',
      'Keep your shoulder blades pulled down and back',
      'Progress the leg extension gradually over weeks',
      'Hips sagging is the first sign of fatigue — reset for the next attempt',
      'Warm up thoroughly — this loads your shoulders, elbows and back hard',
      'Breathe steadily throughout the hold',
      'Quality over duration — a clean line for 5s beats a sagging 15s',
      'Train this 2–3x a week to allow recovery',
      'Keep your neck neutral, chin slightly tucked',
    ],
    angles: ELBOW_HIP, hold: { angle: 'hip', minOk: 50, maxOk: 135 }, targetAngle: 90,
    gauge: { angle: 'hip', label: 'Open', downBelow: 65, upAbove: 120, target: 90 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Keep your arms locked.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'hips-dropping', bodyPart: 'torso', cue: 'Level your hips', say: 'Bring your hips level with your shoulders.', severity: 'warn', test: ({ landmarks }) => {
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          return h != null && s != null && (h - s) > 0.12;
      }},
    ],
  }),
  def({
    slug: 'front-lever', name: 'Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 3,
    muscles: ['back', 'core', 'biceps', 'shoulders'], view: 'side', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'Film your SIDE. Full front lever — body horizontal, legs straight, arms locked.',
    summary: 'Ultimate pulling static hold. Body parallel to the floor, hanging from the bar.',
    howTo: ['Hang from the bar with straight arms.', 'Pull your entire body up and back.', 'Rotate until you\'re horizontal, legs straight.', 'Squeeze everything and hold.'],
    cues: [
      'Body one straight line, parallel to the floor',
      'Arms locked completely straight throughout',
      'Point your toes, squeeze your legs and glutes together',
      'Pull your shoulder blades down and back hard',
      'Keep your lats engaged — think "bend the bar" with your grip',
      'This is an elite pulling skill — even a couple of clean seconds is huge',
      'Warm up your shoulders, elbows and grip thoroughly first',
      'Hips sagging? End the set — that\'s the shape breaking down',
      'Breathe — don\'t hold your breath while straining',
      'Build through tuck and advanced-tuck progressions rather than rushing here',
      'Rest 2–3 minutes between attempts — full recovery matters for skill work',
      'Keep your neck neutral and gaze forward, not down at your feet',
    ],
    angles: ELBOW_HIP_BODY, hold: { angle: 'bodyLine', minOk: 125, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Straightness', downBelow: 120, upAbove: 160, target: 178 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Lock your arms completely.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      { id: 'sag', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your body is sagging — squeeze your glutes and lats to pull horizontal.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
    ],
  }),
  // ───────── HeSPU / 90° Hold (side view) ─────────
  def({
    slug: 'hespu', name: 'Handstand Push-Up (HSPU)', category: 'upper', mode: 'reps', family: 'handstand', level: 2,
    muscles: ['shoulders', 'triceps'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInverted(landmarks),
    setup: 'Film your SIDE from 3–4 m. Kick up against a wall, lower your head toward the floor, press back up.',
    summary: 'Handstand push-up against a wall. Full range — lower deep, press to lockout.',
    howTo: ['Kick up into a handstand against a wall.', 'Lower your head toward the floor.', 'Press back to a straight arm lockout.', 'Keep your body tight throughout.'],
    cues: [
      'Kick up with control against a wall before attempting freestanding',
      'Lower your head toward the floor, not out in front of your hands',
      'Keep your body line straight — don\'t let your back arch as you lower',
      'Press to a full straight-arm lockout at the top every rep',
      'Point your toes and keep your legs together for a tighter, easier line',
      'Control the descent — 2–3 seconds down builds real strength',
      'Breathe steadily — don\'t hold your breath upside down',
      'Place a folded towel under your head as a safety buffer while learning',
      'Grip the floor with spread fingers for balance',
      'Fatiguing fast is normal — this is a demanding press',
      'Warm up wrists and shoulders thoroughly before training this',
      'Progress from pike push-ups if full depth here is still out of reach',
    ],
    angles: ELBOW_AND_BODYLINE,
    rep: { angle: 'elbow', downBelow: 105, upAbove: 155 }, targetAngle: 75,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 105, upAbove: 155, target: 75 },
    formRules: [
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch your back — squeeze your line tight.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Lower further — a full HSPU goes well past 90°, closer to a full bend.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 115 },
    ],
  }),
  def({
    slug: 'hspu-90', name: '90° Push-Up (Handstand)', category: 'upper', mode: 'reps', family: 'handstand', level: 3,
    muscles: ['shoulders', 'triceps'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInverted(landmarks),
    setup: 'Film your SIDE from 3–4 m. Kick up against a wall and pulse reps in the 90° range — not a full lockout, not a full descent.',
    summary: 'A controlled partial rep that stops at 90° elbows — trains the sticking point directly, distinct from a full HSPU.',
    howTo: ['Kick up into a handstand against a wall.', 'Lower only until your elbows reach about 90°.', 'Press back up without locking out fully.', 'Keep the whole set inside that 90° window.'],
    cues: [
      'Stop the descent at 90° — don\'t chase extra depth here, that\'s what full HSPU is for',
      'Press back up but don\'t lock your elbows out fully — stay in the working range',
      'Kick up with control against a wall before attempting freestanding',
      'Keep your body line straight — don\'t let your back arch as you lower',
      'This isolates the hardest part of the handstand push-up — the middle of the range',
      'Control both directions equally — the lift up matters as much as the lower',
      'Point your toes and keep your legs together for a tighter, easier line',
      'Breathe steadily — don\'t hold your breath upside down',
      'Place a folded towel under your head as a safety buffer while learning',
      'If you keep locking out, you\'re pressing too high — shorten the range on purpose',
      'This variation builds the strength that lets a full HSPU feel smooth, not just deep',
      'Rest 2–3 minutes between sets — partial-range pressing at the shoulders fatigues fast',
    ],
    angles: ELBOW_AND_BODYLINE,
    rep: { angle: 'elbow', downBelow: 100, upAbove: 125 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: '90° range', downBelow: 100, upAbove: 125, target: 90 },
    formRules: [
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch your back — squeeze your line tight.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
      { id: 'too-deep', bodyPart: 'arm', cue: 'Stop at 90°', say: 'That\'s deeper than 90 — this variation stops there, it\'s not a full HSPU.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 75 },
      { id: 'locking-out', bodyPart: 'arm', cue: 'Don\'t lock out', say: 'You pressed to a full lockout — for the 90° variant, stop short of straightening all the way.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 150 },
    ],
  }),
  def({
    slug: '90deg-hold', name: '90° Hold', category: 'upper', mode: 'hold', family: 'handstand', level: 4,
    muscles: ['shoulders', 'triceps', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isInverted(landmarks),
    setup: 'Film your SIDE from 3–4 m. Kick up against a wall and lower to 90° — hold!',
    summary: 'Holding a handstand at 90° elbows — the ultimate shoulder endurance test.',
    howTo: ['Kick up into a handstand.', 'Lower until your elbows are at 90°.', 'Hold that position.', 'Fight to keep your body line straight.'],
    cues: [
      'Elbows at 90° — not too bent, not too straight',
      'Keep your body line straight, resist the urge to arch',
      'Kick up against a wall with control, then lower to the hold position',
      'Breathe steadily throughout — don\'t hold your breath',
      'Point your toes and squeeze your legs together for a cleaner line',
      'Grip the floor, fingers spread, for micro-balance adjustments',
      'This is a serious shoulder-endurance test — a few seconds is a real win',
      'Warm up shoulders and wrists thoroughly first',
      'Form breaking down? Come out safely rather than forcing more time',
      'Rest 2–3 minutes between attempts to recover shoulder strength',
      'Build up from HeSPU reps before chasing a static hold at 90°',
      'Keep your neck neutral, gaze between your hands',
    ],
    angles: ELBOW_AND_BODYLINE, hold: { angle: 'elbow', minOk: 40, maxOk: 140 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Elbow', downBelow: 60, upAbove: 120, target: 90 },
    formRules: [
      { id: 'too-bent', bodyPart: 'arm', cue: 'Straighten a bit', say: 'Your elbows are too bent — lift slightly.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 60 },
      { id: 'too-straight', bodyPart: 'arm', cue: 'Bend more', say: 'Lower your elbows to 90°.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 120 },
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch — squeeze your body into a straight line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
    ],
  }),
  // ───────── V-Sit path (side view) ─────────
  def({
    slug: 'l-to-v-raises', name: 'L→V Raises', category: 'core', mode: 'reps', family: 'l-sit', level: 2,
    muscles: ['core', 'triceps', 'hip flexors'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => feetOffFloor(landmarks),
    setup: 'Film your SIDE at floor level. Start in an L-sit and lift your legs toward a V.',
    summary: 'Raise your legs from L-sit toward V-sit. Core and hip flexor work.',
    howTo: ['Start in an L-sit with straight legs.', 'Press through your hands.', 'Lift your legs toward vertical.', 'Lower back to L-sit with control.'],
    cues: [
      'Start from a clean L-sit before raising your legs',
      'Straight legs throughout — locked knees, pointed toes',
      'Lift with control, don\'t swing or use momentum',
      'Press down hard through your hands as you lift',
      'Keep your shoulders down, away from your ears',
      'Lower back to L-sit with the same control you raised with',
      'Breathe out as you lift, in as you lower',
      'Keep your chest lifted, don\'t round your upper back',
      'Legs bending under fatigue? That\'s your signal to stop the set',
      'Your hip flexors and core do the lifting — not momentum from your arms',
      'Build compression strength with static L-sits before adding this raise',
      'Quality reps beat fast, sloppy ones — pause briefly at the top',
    ],
    angles: HIP_AND_KNEE, rep: { angle: 'hip', downBelow: 100, upAbove: 140 }, targetAngle: 160,
    gauge: { angle: 'hip', label: 'Height', downBelow: 100, upAbove: 140, target: 160 },
    formRules: [
      { id: 'bent-legs', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      { id: 'low', cue: 'Lift higher', say: 'Lift your legs above parallel toward vertical.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip < 130 && angles.hip > 90 },
    ],
  }),
  def({
    slug: 'v-sit', name: 'V-Sit', category: 'core', mode: 'hold', family: 'l-sit', level: 3,
    muscles: ['core', 'triceps', 'hip flexors', 'quads'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => feetOffFloor(landmarks, 0),
    setup: 'Film your SIDE at floor level. Hands pressing the floor, legs vertical.',
    summary: 'Ultimate compression hold. Legs vertical, torso vertical — a V with the floor.',
    howTo: ['Sit with legs extended, hands by your hips.', 'Press down and lift your body.', 'Lift your legs to vertical.', 'Hold the V — legs straight, chest proud.'],
    cues: [
      'Legs as close to vertical as you can hold',
      'Chest open and proud, don\'t round forward to compensate',
      'Point your toes and lock your knees straight',
      'Press down hard through your hands to support the hold',
      'Breathe shallow and steady — don\'t hold your breath',
      'Keep your shoulders down away from your ears',
      'Build this from L-sit and L-to-V raises rather than jumping straight in',
      'A few clean seconds beats a long hold with bent knees',
      'Hip flexors will burn fast — that\'s expected at this level',
      'Keep your gaze forward, not down at your legs',
      'Rest fully between attempts — this is a max-effort compression hold',
      'Warm up your hip flexors and hamstrings before attempting',
    ],
    angles: HIP_AND_KNEE, hold: { angle: 'hip', minOk: 95, maxOk: 180 }, targetAngle: 160,
    gauge: { angle: 'hip', label: 'Openness', downBelow: 110, upAbove: 180, target: 160 },
    formRules: [
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees — no bending.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      { id: 'not-high-enough', bodyPart: 'leg', cue: 'Lift your legs higher', say: 'Bring your legs closer to vertical.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip < 120 },
    ],
  }),
  // ───────── Pistol Squat path (side view) ─────────
  def({
    slug: 'assisted-pistol', name: 'Assisted Pistol Squat', category: 'lower', mode: 'reps', family: 'pistol', level: 1,
    muscles: ['quads', 'glutes', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => oneLegForward(landmarks),
    setup: 'Film your SIDE. Hold a doorframe or band. One leg forward, one leg squatting.',
    summary: 'Single-leg squat with assistance. Build toward the full pistol.',
    howTo: ['Extend one leg forward, foot off the floor.', 'Hold a support (doorframe/band).', 'Squat down on the standing leg.', 'Push back up through your heel.'],
    cues: [
      'Keep your extended leg locked straight, foot off the floor throughout',
      'Chest up and proud — don\'t let your torso collapse forward',
      'Use light assistance — just enough to stay balanced, not to bear real weight',
      'Push through your heel, not your toes, as you stand',
      'Go to full depth — hamstring to calf — for the real benefit',
      'Keep your standing knee tracking over your toes, not caving in',
      'Control the descent — don\'t just drop into the bottom',
      'Exhale as you drive up out of the bottom',
      'Reduce assistance gradually over weeks as balance and strength improve',
      'Keep your arms forward for counterbalance, not flailing',
      'Limited ankle mobility? Elevate your heel slightly on a small plate',
      'Balance is half the battle — practice the bottom position statically too',
    ],
    angles: MIN_KNEE, rep: { angle: 'knee', downBelow: 128, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 128, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Squat deeper — aim for parallel or below.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 140 },
      { id: 'extended-leg-bent', bodyPart: 'leg', cue: 'Straighten your extended leg', say: 'Keep your front leg straight — foot off the floor.', severity: 'warn', test: ({ landmarks }) => {
          const lh = landmarks[L.LeftHip]; const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rh = landmarks[L.RightHip]; const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (!lk || !rk || !la || !ra) return false;
          if (la.y < ra.y && la.visibility >= 0.5 && lh && lk && la) {
            return jointAngle(lh, lk, la) < 150;
          }
          if (ra.y < la.y && ra.visibility >= 0.5 && rh && rk && ra) {
            return jointAngle(rh, rk, ra) < 150;
          }
          return false;
      }},
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest proud and back straight.', severity: 'info', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  def({
    slug: 'negative-pistol', name: 'Negative Pistol Squat', category: 'lower', mode: 'reps', family: 'pistol', level: 2,
    muscles: ['quads', 'glutes', 'core'], view: 'side', requiredJoints: STANDING, countEccentric: true,
    gate: ({ landmarks }) => oneLegForward(landmarks),
    setup: 'Film your SIDE. Lower on one leg slowly, step down with both feet to reset.',
    summary: 'Eccentric pistol squat. Lower on one leg, then use both to stand back up.',
    howTo: ['Extend one leg forward, arms forward for balance.', 'Lower slowly on the standing leg.', 'Resist all the way down.', 'Use both legs to stand back up and reset.'],
    cues: [
      'Lower slowly — aim for a full 3–5 second descent',
      'Keep your extended leg locked straight the entire way down',
      'Chest up throughout — don\'t fold forward as you fatigue',
      'Resist all the way to the bottom, don\'t let gravity win halfway down',
      'Use both legs to stand back up and reset for the next rep',
      'Push your arms forward for counterbalance as you lower',
      'Keep your standing heel planted the whole way down',
      'This builds the strength for a full pistol — trust the process',
      'Track your knee over your toes, don\'t let it cave inward',
      'Breathe steadily — don\'t hold your breath through the descent',
      'Losing control is the sign to slow down even more next rep',
      'A slow, shaky negative beats a fast, uncontrolled one every time',
    ],
    angles: MIN_KNEE, rep: { angle: 'knee', downBelow: 128, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 128, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go deeper', say: 'Squat deeper — aim for 90° or below.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 120 && angles.knee < 155 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest up, back straight.', severity: 'info', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  def({
    slug: 'pistol', name: 'Pistol Squat', category: 'lower', mode: 'reps', family: 'pistol', level: 3,
    muscles: ['quads', 'glutes', 'core', 'hamstrings'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => oneLegForward(landmarks),
    setup: 'Film your SIDE. Full pistol squat — unassisted single-leg squat with full control.',
    summary: 'Single-leg squat, unassisted. The king of lower-body calisthenics.',
    howTo: ['Extend one leg forward, foot off the floor.', 'Arms forward for counterbalance.', 'Squat all the way down on one leg.', 'Drive back up through your heel.'],
    cues: [
      'Full depth — hamstring to calf — every single rep',
      'Extended leg locked straight and off the floor throughout',
      'Chest up and proud, back straight — don\'t fold forward',
      'Heel planted the entire rep, don\'t let it lift',
      'Arms forward for counterbalance as you descend',
      'Control the descent — don\'t just drop into the bottom',
      'Drive up through your heel and midfoot, not your toes',
      'Keep your knee tracking over your toes, not caving in',
      'Exhale as you stand up out of the bottom',
      'Balance is the limiter? Practice the bottom position statically first',
      'Alternate legs each set to keep both sides even',
      'One of the hardest bodyweight leg moves — patience over months, not weeks',
    ],
    angles: (lms) => ({ ...MIN_KNEE(lms), torsoLean: verticalDeviation(lms[L.LeftShoulder], lms[L.LeftHip]) }),
    rep: { angle: 'knee', downBelow: 128, upAbove: 160 }, targetAngle: 75,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 128, upAbove: 160, target: 75 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go deeper', say: 'Squat all the way — hamstring to calf.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 140 },
      { id: 'extended-leg-bent', bodyPart: 'leg', cue: 'Straighten your extended leg', say: 'Keep your front leg locked straight — foot off the floor.', severity: 'warn', test: ({ landmarks }) => {
          const lh = landmarks[L.LeftHip]; const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rh = landmarks[L.RightHip]; const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (!lk || !rk || !la || !ra) return false;
          if (la.y < ra.y && la.visibility >= 0.5 && lh && lk && la) {
            return jointAngle(lh, lk, la) < 150;
          }
          if (ra.y < la.y && ra.visibility >= 0.5 && rh && rk && ra) {
            return jointAngle(rh, rk, ra) < 150;
          }
          return false;
      }},
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest proud and back straight.', severity: 'info', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  // ───────── Diamond Push-Up (front view) ─────────
  def({
    slug: 'diamond-pushup', name: 'Diamond Push-Up', category: 'upper', mode: 'reps', family: 'push', level: 2,
    muscles: ['triceps', 'chest', 'shoulders'], view: 'front', requiredJoints: ARMS, hideLegs: true,
    gate: ({ landmarks }) => isProne(landmarks) && handsTogether(landmarks),
    setup: 'FACE the camera. Hands close together forming a diamond under your chest.',
    summary: 'Narrow-grip push-up. Hands together — all triceps.',
    howTo: ['Hands together, index fingers and thumbs form a diamond.', 'Body in a straight line.', 'Lower until your chest touches your hands.', 'Press up with triceps.'],
    cues: [
      'Hands together, thumbs and index fingers touching to form a diamond',
      'Elbows track back toward your feet, not out to the sides',
      'Lower until your chest touches your hands every rep',
      'Body one straight line, head to heels — don\'t let hips sag',
      'This narrow grip is harder on your triceps — expect fewer reps than regular push-ups',
      'Full lockout at the top every rep',
      'Keep your neck neutral, gaze just ahead of your hands',
      'Exhale as you press up, control the lowering phase down',
      'Wrists aching? Try it on fists or slightly wider hands while mobility improves',
      'Brace your core hard — the narrow base makes stability harder',
      'Build up from regular push-ups if diamond reps drop off a cliff',
      'Warm up your wrists and elbows before training this variation',
    ],
    angles: ELBOW_AND_BODYLINE, rep: { angle: 'elbow', downBelow: 95, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 95, upAbove: 155, target: 90 },
    formRules: [
      { id: 'body-line', bodyPart: 'torso', cue: 'Straighten your body', say: 'Keep your body in one straight line from head to heels.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 160 },
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Lower your chest to your hands.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      { id: 'elbows-flare', bodyPart: 'arm', cue: 'Elbows back, not out', say: 'Keep your elbows pointed back toward your feet, not flaring out.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const le = landmarks[L.LeftElbow];
          const lw = landmarks[L.LeftWrist];
          return ls != null && le != null && lw != null && ls.visibility >= 0.5 && le.visibility >= 0.5 && lw.visibility >= 0.5
            ? (le.x - lw.x) > (ls.x - le.x) * 1.2 : false;
      }},
    ],
  }),
  // ───────── Hanging Knee Raise (side view, bar) ─────────
  def({
    slug: 'hanging-knee-raise', name: 'Hanging Knee Raise', category: 'core', mode: 'reps', family: 'hanging-raise', level: 1,
    muscles: ['core', 'hip flexors'], view: 'side', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'Film your SIDE from 2–3 m. Hang from the bar and raise your knees to your chest.',
    summary: 'The essential hanging core exercise. Knees to chest, controlled.',
    howTo: ['Hang from the bar with straight arms.', 'Raise your knees toward your chest.', 'Lower with control to a full hang.', 'No swinging.'],
    cues: [
      'Raise your knees above your hips for a full contraction',
      'No swinging — control the movement with your core, not momentum',
      'Lower with control back to a full, straight-arm hang',
      'Keep your arms locked straight throughout the set',
      'Exhale as you raise your knees, inhale as you lower',
      'Squeeze your abs at the top rather than just lifting your legs',
      'Keep your shoulders engaged, not just passively hanging',
      'Swinging a lot? Slow down and shorten the range until control improves',
      'A dead hang between reps resets momentum — don\'t rush into the next one',
      'Progress to straight-leg raises once knee raises feel easy',
      'Grip just outside shoulder width for a stable hang',
      'Keep your neck relaxed, don\'t crane it looking down at your knees',
    ],
    angles: (lms) => ({ ...KNEE(lms), ...HIP(lms), ...ELBOW(lms) }), rep: { angle: 'hip', downBelow: 60, upAbove: 90 }, targetAngle: 40,
    gauge: { angle: 'hip', label: 'Compression', downBelow: 60, upAbove: 90, target: 40 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Keep your arms locked at the bottom.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'partial', cue: 'Knees higher', say: 'Raise your knees above your hips.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 70 },
      { id: 'swinging', bodyPart: 'torso', cue: 'Stop swinging', say: 'Control the movement — no momentum.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (!ls || !rs || !lh || !rh) return false;
          const shoulderX = (ls.x + rs.x) / 2;
          const hipX = (lh.x + rh.x) / 2;
          return Math.abs(shoulderX - hipX) > 0.15;
      }},
    ],
  }),
  // ───────── Muscle-Up path (front view) ─────────
  def({
    slug: 'chest-to-bar', name: 'Chest-to-Bar Pull-Up', category: 'upper', mode: 'reps', family: 'muscle-up', level: 1,
    muscles: ['back', 'biceps', 'shoulders'], view: 'front', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'FACE the camera at the bar. Pull your chest all the way to the bar — explosive!',
    summary: 'Explosive pull-up. Chest contacts the bar — the power half of the muscle-up.',
    howTo: ['Hang from the bar with straight arms.', 'Pull explosively, leaning back slightly.', 'Drive your chest toward the bar.', 'Lower with control.'],
    cues: [
      'Pull explosively — this is a power move, not a slow grind',
      'Drive your chest all the way to the bar, not just your chin',
      'Lean back slightly as you pull to clear the bar with your chest',
      'Lower with control — don\'t just drop back to a dead hang',
      'Full dead hang at the bottom between reps',
      'Keep your legs still — no kipping or swinging for momentum',
      'Squeeze your shoulder blades together before you pull',
      'Exhale hard as you drive up',
      'This builds the power half of a muscle-up — treat it as strength training',
      'Grip just outside shoulder width',
      'Rest fully between sets — explosive pulls are demanding',
      'Chest never reaches the bar? Work regular pull-ups for more pulling strength first',
    ],
    angles: ELBOW, rep: { angle: 'elbow', downBelow: 70, upAbove: 150 }, targetAngle: 40,
    gauge: { angle: 'elbow', label: 'Pull height', downBelow: 70, upAbove: 150, target: 40 },
    formRules: [
      { id: 'partial', bodyPart: 'arm', cue: 'Pull higher', say: 'Pull until your chest touches the bar.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow > 70 && angles.elbow < 100 },
      { id: 'kipping', bodyPart: 'torso', cue: 'No kipping', say: 'Use your back and arms — don\'t swing your legs.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (!ls || !rs || !lh || !rh) return false;
          if (ls.visibility < 0.5 || rs.visibility < 0.5 || lh.visibility < 0.5 || rh.visibility < 0.5) return false;
          return Math.abs((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) > 0.15;
      }},
    ],
  }),
  def({
    slug: 'transition-negative', name: 'Transition Negative', category: 'upper', mode: 'reps', family: 'muscle-up', level: 2,
    muscles: ['back', 'triceps', 'shoulders', 'core'], view: 'front', requiredJoints: ARMS, showBar: true, countEccentric: true,
    gate: ({ landmarks }) => belowBar(landmarks),
    setup: 'FACE the camera. Jump or pull to support, then lower through the transition slowly.',
    summary: 'Eccentric muscle-up transition. Lower from support to dead hang through the hard part.',
    howTo: ['Start in a support position (shoulders over the bar).', 'Lean forward slightly.', 'Lower through the transition slowly.', 'End in a dead hang.'],
    cues: [
      'Lower slowly — 3–5 seconds through the hardest part of the muscle-up',
      'Lean forward as you lower to stay close to the bar',
      'Start from a solid support position, shoulders over the bar',
      'Control the rotation of your wrists as you go over and back',
      'End in a full dead hang at the bottom',
      'Keep your core braced throughout — this protects your shoulders',
      'Breathe steadily — don\'t hold your breath through the hardest range',
      'This is the single best drill for building the muscle-up transition',
      'Drop fast partway? That\'s exactly where to focus extra-slow reps',
      'Use a slight jump or spot to get to the top support position safely',
      'Rest well between reps — this is a strength-focused drill, not conditioning',
      'Progress by adding a second to your lowering time every week or two',
    ],
    angles: ELBOW,
    rep: { angle: 'elbow', downBelow: 105, upAbove: 165 }, targetAngle: 180,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 105, upAbove: 165, target: 180 },
    formRules: [
      { id: 'fast-drop', cue: 'Lower slower', say: 'Control the descent — at least 3 seconds.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 120 },
    ],
  }),
  def({
    slug: 'muscle-up', name: 'Muscle-Up', category: 'upper', mode: 'reps', family: 'muscle-up', level: 3,
    muscles: ['back', 'triceps', 'shoulders', 'chest', 'core'], view: 'front', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks),
    setup: 'FACE the camera at the bar. Full muscle-up — explode up, transition over the bar, press to support.',
    summary: 'The ultimate pulling move. From dead hang to full support in one motion.',
    howTo: ['Hang from the bar, slight kip for momentum.', 'Explosive pull, leaning back.', 'As your chest reaches the bar, rotate your elbows over.', 'Press up to full support.'],
    cues: [
      'Pull explosively and lean back as you rise',
      'Punch your elbows over the bar as your chest reaches it',
      'Press to a full lockout at the top of the support',
      'Full dead hang at the bottom between reps',
      'Keep the kip minimal — control beats a wild swing',
      'Lower with control back through the transition, don\'t just drop',
      'Grip just outside shoulder width for the pull and the turnover',
      'Breathe steadily — don\'t hold your breath through the whole rep',
      'This combines a pull-up and a dip — make sure both are strong on their own first',
      'Transition stalling? Drill transition negatives separately',
      'Rest fully between reps — this is a maximal-effort skill move',
      'Chest-to-bar pull-ups and dips build the two halves — train them if muscle-ups stall',
    ],
    angles: ELBOW, rep: { angle: 'elbow', downBelow: 85, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Pull depth', downBelow: 85, upAbove: 155, target: 90 },
    formRules: [
      { id: 'no-transition', cue: 'Punch through the transition', say: 'Rotate your elbows over the bar as you reach the top of your pull.', severity: 'warn', test: ({ landmarks }) => {
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (!lw || !rw || !ls || !rs) return false;
          const wristY = Math.min(lw.y, rw.y);
          const shoulderY = Math.min(ls.y, rs.y);
          // If wrists are well below shoulders (fail transition) while elbows are bent
          return wristY > shoulderY + 0.08;
      }},
    ],
  }),
  // ───────── Home-workout staples ─────────
  def({
    slug: 'reverse-lunge', name: 'Reverse Lunge', category: 'lower', mode: 'reps', family: 'lunge', level: 1,
    muscles: ['quads', 'glutes', 'hamstrings'], view: 'side', requiredJoints: STANDING,
    setup: 'Film your SIDE, phone upright 2–3 m away — head to feet in frame. It watches whichever leg is bent.',
    summary: 'The easiest lunge on your knees. Step back, drop straight down, drive back to standing.',
    howTo: ['Stand tall, feet hip-width.', 'Step one leg back, lowering your rear knee toward the floor.', 'Front thigh reaches parallel to the floor.', 'Drive through your front heel back to standing.'],
    cues: [
      'Step back far enough that your front shin stays roughly vertical',
      'Drop your back knee straight down, not forward',
      'Keep your torso upright — don\'t lean forward over your front knee',
      'Push through your front heel to stand back up',
      'Both knees bend to about 90° at the bottom',
      'Control the step back — don\'t just fall into position',
      'Alternate legs evenly, or finish all reps on one side then switch',
      'Keep your core braced so you don\'t wobble sideways',
      'Look straight ahead, not down at your feet',
      'This is gentler on your knees than a forward lunge — a great starting point',
      'If your front knee caves inward, slow down and reset your stance width',
      'Full stand at the top between reps — don\'t rush into the next one',
    ],
    angles: MIN_KNEE, rep: { angle: 'knee', downBelow: 110, upAbove: 158 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 110, upAbove: 158, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Drop your back knee closer to the floor.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 130 && angles.knee < 155 },
      { id: 'lean-forward', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your torso upright — don\'t lean over your front knee.', severity: 'warn', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  def({
    slug: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', category: 'lower', mode: 'reps', family: 'lunge', level: 2,
    muscles: ['quads', 'glutes', 'hamstrings'], view: 'side', requiredJoints: STANDING,
    setup: 'Film your SIDE. Rear foot up on a chair or bench behind you, front leg doing the work.',
    summary: 'Rear-foot-elevated lunge — a serious single-leg quad and glute builder.',
    howTo: ['Rear foot up on a bench, laces down.', 'Front foot far enough forward that your knee tracks over your ankle.', 'Lower straight down until your front thigh is near parallel.', 'Drive through your front heel to stand.'],
    cues: [
      'Front foot far enough forward that your knee doesn\'t drift past your toes',
      'Lower straight down — think "down," not "forward"',
      'Keep most of your weight in your front leg, not the elevated rear foot',
      'Front thigh reaches close to parallel at the bottom',
      'Torso stays upright, chest proud',
      'Drive through your front heel and midfoot to stand',
      'Control the descent — this is much harder than it looks',
      'Expect real muscle burn and some wobble at first — that\'s normal',
      'Keep your core braced to stay balanced on one leg',
      'Full lockout at the top before the next rep',
      'If your knee caves in, drop the range of motion until control improves',
      'Do all reps on one side, then switch — don\'t alternate mid-set',
    ],
    angles: MIN_KNEE, rep: { angle: 'knee', downBelow: 105, upAbove: 160 }, targetAngle: 85,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 105, upAbove: 160, target: 85 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Lower until your front thigh is close to parallel.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 125 && angles.knee < 150 },
      { id: 'lean-forward', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your torso upright as you lower.', severity: 'warn', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  def({
    slug: 'side-lunge', name: 'Side Lunge', category: 'lower', mode: 'reps', family: 'side-lunge', level: 1,
    muscles: ['quads', 'glutes', 'hamstrings'], view: 'front', requiredJoints: STANDING,
    setup: 'FACE the camera, standing 2–3 m back, full body in frame. It watches whichever leg you shift onto.',
    summary: 'Lateral squat — steps sideways under control, working your inner and outer thighs.',
    howTo: ['Stand tall, feet wide together.', 'Step one leg out to the side.', 'Bend that knee and sit your hips back, keeping the other leg straight.', 'Push off that foot back to center.'],
    cues: [
      'Push your hips back as you sit into the bent leg, like a sideways squat',
      'Keep the straight leg\'s foot flat, don\'t let your weight roll onto its edge',
      'Chest stays up and proud, don\'t round forward',
      'Bent knee tracks over its toes, not caving inward',
      'Push off firmly through the bent-leg heel to return to center',
      'Keep your feet pointed roughly forward throughout',
      'Control the step out — don\'t just fall sideways into position',
      'Alternate sides evenly for balanced hip and inner-thigh strength',
      'Go only as low as you can with a flat straight-leg foot',
      'Keep your core braced to avoid twisting your hips',
      'This targets your inner thighs and glutes more than a regular squat',
      'Full stand back to center between reps',
    ],
    angles: MIN_KNEE, rep: { angle: 'knee', downBelow: 115, upAbove: 158 }, targetAngle: 100,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 115, upAbove: 158, target: 100 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Sit deeper into the bent leg.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 135 && angles.knee < 160 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest up as you shift into the lunge.', severity: 'info', test: ({ landmarks }) => {
          const lean = verticalDeviation(landmarks[L.LeftShoulder], landmarks[L.LeftHip]);
          return lean != null && lean > 35;
      }},
    ],
  }),
  def({
    slug: 'glute-bridge', name: 'Glute Bridge', category: 'lower', mode: 'reps', family: 'glute-bridge', level: 1,
    muscles: ['glutes', 'hamstrings', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level, lying on your back with knees bent. It watches your hip rise and fall.',
    summary: 'The essential glute exercise. Lying on your back, drive your hips up into a straight line.',
    howTo: ['Lie on your back, knees bent, feet flat hip-width apart.', 'Squeeze your glutes and press through your heels.', 'Lift your hips until your body is a straight line knee to shoulder.', 'Lower with control, without fully resting between reps.'],
    cues: [
      'Squeeze your glutes hard at the top — that\'s the whole point of the rep',
      'Push through your heels, not your toes',
      'Lift until your knees, hips and shoulders form one straight line',
      'Don\'t let your lower back overarch at the top — squeeze glutes, not just arch',
      'Keep your feet flat, hip-width apart, close enough to touch your fingertips',
      'Pause briefly at the top before lowering',
      'Control the descent — don\'t just drop your hips',
      'Keep your core lightly braced throughout',
      'Breathe out as you lift, in as you lower',
      'If your hamstrings cramp, move your feet slightly further from your hips',
      'This is the foundation for single-leg glute bridges later',
      'Higher reps work well here — glutes respond well to volume',
    ],
    angles: HIP_LIFT, rep: { angle: 'hip', downBelow: 105, upAbove: 135 }, targetAngle: 155,
    gauge: { angle: 'hip', label: 'Lift', downBelow: 105, upAbove: 135, target: 155 },
    formRules: [
      { id: 'shallow', cue: 'Lift your hips', say: 'Drive your hips higher — squeeze your glutes at the top.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 105 && angles.hip < 130 },
    ],
  }),
  def({
    slug: 'single-leg-glute-bridge', name: 'Single-Leg Glute Bridge', category: 'lower', mode: 'reps', family: 'glute-bridge', level: 2,
    muscles: ['glutes', 'hamstrings', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level. One knee bent and planted, the other leg extended straight.',
    summary: 'Glute bridge on one leg — doubles the load on the working glute.',
    howTo: ['Lie on your back, one knee bent and foot planted.', 'Extend the other leg straight, in line with your torso.', 'Drive through the planted heel to lift your hips level.', 'Lower with control, keeping hips square.'],
    cues: [
      'Keep your hips level — don\'t let the unsupported side drop',
      'Squeeze the working glute hard at the top',
      'Push through the planted heel, not your toes',
      'Keep the extended leg in line with your torso, not sagging',
      'This is much harder than the two-leg version — fewer reps is normal',
      'Control the descent every rep, don\'t bounce',
      'Keep your core braced to stop your hips twisting',
      'Breathe out as you lift, in as you lower',
      'If your lower back takes over, that means your glute isn\'t firing — slow down and refocus',
      'Master the two-leg bridge first if this feels unstable',
      'Do all reps on one side, then switch legs',
      'Higher reps on each side build real single-leg strength',
    ],
    angles: HIP_LIFT, rep: { angle: 'hip', downBelow: 105, upAbove: 130 }, targetAngle: 150,
    gauge: { angle: 'hip', label: 'Lift', downBelow: 105, upAbove: 130, target: 150 },
    formRules: [
      { id: 'shallow', cue: 'Lift your hips', say: 'Drive your hips higher and level.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 105 && angles.hip < 125 },
    ],
  }),
  def({
    slug: 'wall-sit', name: 'Wall Sit', category: 'lower', mode: 'hold', family: 'wall-sit', level: 1,
    muscles: ['quads', 'glutes'], view: 'side', requiredJoints: STANDING,
    setup: 'Film your SIDE, phone upright 2–3 m away. Back flat against a wall, thighs parallel to the floor.',
    summary: 'A no-equipment quad burner. Sit against a wall like an invisible chair.',
    howTo: ['Back flat against a wall.', 'Walk your feet out and slide down until your thighs are parallel to the floor.', 'Knees stacked over your ankles, not past your toes.', 'Hold, breathing steadily.'],
    cues: [
      'Thighs parallel to the floor — not higher, not lower',
      'Knees stacked over your ankles, not pushed past your toes',
      'Keep your whole back flat against the wall, especially your lower back',
      'Weight in your heels, not your toes',
      'Breathe steadily — don\'t hold your breath through the burn',
      'The burn in your quads is expected — that\'s the exercise working',
      'Keep your core braced to protect your lower back',
      'Arms relaxed at your sides or resting on your thighs',
      'Build time gradually — add 5–10s per week rather than chasing a max hold',
      'If your knees ache, check they aren\'t pushed forward past your toes',
      'A shaky finish is normal — that\'s near-failure, not a sign of doing it wrong',
      'Rest fully between attempts if you\'re doing more than one',
    ],
    angles: KNEE, hold: { angle: 'knee', minOk: 60, maxOk: 115 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Angle', downBelow: 70, upAbove: 110, target: 90 },
    formRules: [
      { id: 'too-high', bodyPart: 'leg', cue: 'Sit lower', say: 'Slide down until your thighs are parallel to the floor.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 115 },
      { id: 'too-low', bodyPart: 'leg', cue: 'Come up slightly', say: 'You\'re below parallel — rise a touch to protect your knees.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 65 },
    ],
  }),
  def({
    slug: 'jump-squat', name: 'Jump Squat', category: 'lower', mode: 'reps', family: 'squat', level: 2,
    muscles: ['quads', 'glutes', 'calves'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => feetPlanted(landmarks, 0.2),
    setup: 'Film your SIDE, phone upright 2–3 m away — head to feet in frame, with room to land.',
    summary: 'Explosive squat with a jump at the top — builds power, not just strength.',
    howTo: ['Squat down to about parallel.', 'Explode upward into a jump.', 'Land softly, bending your knees to absorb the impact.', 'Reset straight into the next rep.'],
    cues: [
      'Load the squat first — don\'t skip depth to jump higher',
      'Explode straight up through your heels and midfoot',
      'Land soft — bend your knees on landing, don\'t land stiff-legged',
      'Reset your depth every rep, don\'t let it creep shallower as you fatigue',
      'Swing your arms to help drive the jump',
      'Keep your chest up throughout, even mid-air',
      'This is a power move — quality over speed of reps',
      'Make sure you have clear space to land safely',
      'If your knees or joints ache, reduce jump height and focus on the squat itself',
      'Rest a beat between reps early on — this is more taxing than a regular squat',
      'A soft, quiet landing is the sign of good control',
      'Great finisher for a leg session, not necessarily a warm-up move',
    ],
    angles: KNEE, rep: { angle: 'knee', downBelow: 110, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 110, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Load the squat deeper before you explode up.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 125 && angles.knee < 150 },
    ],
  }),
  def({
    slug: 'side-plank', name: 'Side Plank', category: 'core', mode: 'hold', family: 'side-plank', level: 1,
    muscles: ['core', 'shoulders'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level, propped on one forearm with your body stacked sideways.',
    summary: 'Anti-lateral-flexion core hold. Stay flat and braced on your side.',
    howTo: ['Lie on your side, propped on your forearm, elbow under your shoulder.', 'Stack your feet, or stagger them for balance.', 'Lift your hips so your body forms a straight line.', 'Hold, breathing steadily.'],
    cues: [
      'One straight line from head to feet — no sagging at the hips',
      'Elbow stacked directly under your shoulder',
      'Squeeze your obliques to keep your hips lifted',
      'Don\'t let your top shoulder roll forward or back',
      'Stack your feet for a harder hold, stagger them for more stability',
      'Keep breathing — don\'t hold your breath',
      'A slight hip sag is the first sign of fatigue — reset if you can',
      'Prop your bottom knee down instead if the full version is too hard yet',
      'Build time gradually on both sides evenly',
      'Keep your neck neutral, gaze forward, not down',
      'If your shoulder aches, check your elbow is directly under it, not out in front',
      'Train both sides — most people are noticeably weaker on one',
    ],
    angles: BODYLINE, hold: { angle: 'bodyLine', minOk: 130, maxOk: 180 }, targetAngle: 178,
    formRules: [
      { id: 'sag', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze your obliques and lift them into line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 158 },
    ],
  }),
  def({
    slug: 'superman-hold', name: 'Superman Hold', category: 'core', mode: 'hold', family: 'superman', level: 1,
    muscles: ['back', 'glutes', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level, lying face down. It watches your shoulders and knees lift off the floor.',
    summary: 'Prone extension hold — strengthens the muscles that keep your back healthy.',
    howTo: ['Lie face down, arms extended in front of you.', 'Lift your chest, arms and legs off the floor together.', 'Hold a gentle arch, squeezing your lower back and glutes.', 'Lower with control at the end of the hold.'],
    cues: [
      'Lift your chest, arms and legs all together, not just one part',
      'Squeeze your glutes and lower back to hold the arch',
      'Keep your neck neutral — don\'t crane your head up to look forward',
      'This should feel like a gentle arch, not a violent hyperextension',
      'Reach your arms and legs long, away from your center',
      'Breathe steadily — don\'t hold your breath',
      'A small, controlled lift beats a big, shaky one',
      'Keep your shoulders down, away from your ears',
      'If your lower back pinches, lower the height of the hold slightly',
      'Great counterbalance to all the forward-flexion core work (planks, sit-ups)',
      'Build hold time gradually — this is a small-muscle endurance move',
      'Rest fully between attempts',
    ],
    angles: HIP, hold: { angle: 'hip', minOk: 130, maxOk: 176 }, targetAngle: 155,
    formRules: [
      { id: 'flat', cue: 'Lift higher', say: 'Lift your chest and legs higher off the floor.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 176 },
    ],
  }),
  def({
    slug: 'hollow-hold', name: 'Hollow Body Hold', category: 'core', mode: 'hold', family: 'hollow-hold', level: 1,
    muscles: ['core', 'hip flexors'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level, lying on your back. It watches your shoulders and legs lift into the curve.',
    summary: 'Full-body compression hold — the foundation for handstands, levers and gymnastics skills.',
    howTo: ['Lie on your back, arms extended overhead.', 'Press your lower back into the floor.', 'Lift your shoulders and legs off the floor into a gentle curve.', 'Hold, keeping your lower back glued down.'],
    cues: [
      'Press your lower back flat into the floor — that\'s the whole point of the hold',
      'Lift your shoulder blades and legs off the floor together',
      'Keep your legs together, toes pointed',
      'Arms stay by your ears or by your sides, not flailing',
      'If your back arches off the floor, raise your legs higher until it presses back down',
      'Breathe steadily — don\'t hold your breath',
      'Bend your knees (tuck) if the straight-leg version breaks your form',
      'This underpins nearly every advanced skill in the app — worth training often',
      'A small, controlled curve beats a big shape with an arched back',
      'Keep your neck relaxed, chin slightly tucked',
      'Build hold time gradually — a shaky 10s is real progress',
      'Rest fully between attempts — this fatigues your core fast',
    ],
    angles: HIP, hold: { angle: 'hip', minOk: 125, maxOk: 172 }, targetAngle: 150,
    formRules: [
      { id: 'flat', cue: 'Lift higher', say: 'Lift your shoulders and legs higher into the curve.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 172 },
    ],
  }),
  def({
    slug: 'leg-raise', name: 'Lying Leg Raise', category: 'core', mode: 'reps', family: 'leg-raise', level: 1,
    muscles: ['core', 'hip flexors'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2),
    setup: 'Film your SIDE at floor level, lying on your back with legs extended.',
    summary: 'Straight-leg raise from the floor — builds the lower-abs strength behind an L-sit.',
    howTo: ['Lie on your back, legs extended, hands by your hips or under your lower back.', 'Keep your legs straight and lift them toward vertical.', 'Lower with control, stopping just before your heels touch down.', 'Repeat without resting fully at the bottom.'],
    cues: [
      'Keep your legs straight throughout — locked knees, pointed toes',
      'Lift with your lower abs, not by rocking your hips',
      'Lower under control — don\'t let gravity drop your legs',
      'Stop just short of the floor at the bottom to keep tension on',
      'Press your lower back down, don\'t let it arch as your legs lower',
      'Keep your shoulders and head relaxed on the floor',
      'Bend your knees slightly if straight legs make your back arch',
      'Breathe out as you lift, in as you lower',
      'Slow reps beat fast, swinging ones every time',
      'If your hip flexors cramp, that\'s normal early on — they do most of the work here',
      'This builds directly toward L-sit and V-sit strength',
      'Quality over quantity — a handful of clean reps beats twenty sloppy ones',
    ],
    angles: HIP, rep: { angle: 'hip', downBelow: 100, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'hip', label: 'Height', downBelow: 100, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', cue: 'Lift higher', say: 'Lift your legs closer to vertical.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 120 && angles.hip < 150 },
    ],
  }),
  def({
    slug: 'incline-pushup', name: 'Incline Push-Up', category: 'upper', mode: 'reps', family: 'push', level: 0.5,
    muscles: ['chest', 'triceps', 'shoulders'], view: 'side', requiredJoints: ARMS_AND_HIPS,
    setup: 'Film your SIDE, phone ~2 m away at bench height. Facing the camera is awkward on an incline — side-on shows your arm bend and body line clearly.',
    summary: 'Easier push-up angle. Hands elevated, less bodyweight to press — the on-ramp to a full push-up.',
    howTo: ['Hands on a stable elevated surface, shoulder-width.', 'Body in a straight line from head to heels.', 'Lower your chest toward your hands.', 'Press back up to a full lockout.'],
    cues: [
      'The higher the surface, the easier the rep — pick a height you can control',
      'Keep your body in one straight line, don\'t let your hips sag',
      'Elbows track back at about 45°, not flared wide',
      'Full lockout at the top every rep',
      'Lower until your chest nearly touches your hands',
      'As this gets easy, lower the surface height to keep progressing',
      'Control the descent — 2 seconds down builds more than dropping fast',
      'Keep your neck neutral, gaze just ahead of your hands',
      'This is a legitimate strength builder, not just a "beginner" move — own it',
      'Once you can do 15–20 clean reps here, try a push-up on the flat floor',
      'Brace your core so your hips don\'t drop as you fatigue',
      'Make sure your surface is stable and won\'t slide as you push',
    ],
    angles: ELBOW_AND_BODYLINE, rep: { angle: 'elbow', downBelow: 120, upAbove: 158 }, targetAngle: 100,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 120, upAbove: 158, target: 100 },
    formRules: [
      { id: 'body-line', bodyPart: 'torso', cue: 'Straighten your body', say: 'Keep your body in one straight line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 160 },
      { id: 'shallow', bodyPart: 'arm', cue: 'Go a little lower', say: 'Lower your chest closer to your hands.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 135 && angles.elbow < 155 },
    ],
  }),
  def({
    slug: 'decline-pushup', name: 'Decline Push-Up', category: 'upper', mode: 'reps', family: 'push', level: 1.5,
    muscles: ['chest', 'triceps', 'shoulders'], view: 'front', requiredJoints: ARMS, hideLegs: true,
    gate: ({ landmarks }) => isProne(landmarks),
    setup: 'FACE the camera: feet up on a chair or step behind you, hands on the floor, phone ~1.5–2 m in front.',
    summary: 'Feet-elevated push-up — more shoulder and upper-chest load than a standard push-up.',
    howTo: ['Feet up on a stable chair or box behind you.', 'Hands on the floor, shoulder-width.', 'Lower your chest toward the floor.', 'Press back up without letting your hips sag.'],
    cues: [
      'The higher your feet, the harder the rep — start modest',
      'One straight line from head to heels, don\'t let your hips pike or sag',
      'Elbows track back at about 45°, not flared wide',
      'Full lockout at the top every rep',
      'This shifts more load to your shoulders — expect fewer reps than flat push-ups',
      'Control the descent — 2–3 seconds down is where the strength is built',
      'Keep your neck neutral, gaze just ahead of your hands',
      'Make sure your foot platform is stable before loading it fully',
      'Brace your core hard — the incline makes hip sag more likely',
      'If your shoulders pinch, lower the foot height until mobility improves',
      'This bridges the gap between push-ups and pike push-ups',
      'Warm up your shoulders and wrists before training this variation',
    ],
    angles: ELBOW_AND_BODYLINE, rep: { angle: 'elbow', downBelow: 100, upAbove: 155 }, targetAngle: 85,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 100, upAbove: 155, target: 85 },
    formRules: [
      { id: 'body-line', bodyPart: 'torso', cue: 'Straighten your body', say: 'Keep your body in one straight line — don\'t let your hips sag or pike.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 158 },
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Lower your chest closer to the floor.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 115 && angles.elbow < 140 },
    ],
  }),
  def({
    slug: 'jumping-jack', name: 'Jumping Jack', category: 'full', mode: 'reps', family: 'jumping-jack', level: 1,
    muscles: ['quads', 'calves', 'shoulders'], view: 'front', requiredJoints: ARMS_AND_HIPS,
    setup: 'FACE the camera, standing 2–3 m back, full body in frame with room to jump.',
    summary: 'The classic cardio warm-up. Arms and legs out, then back together.',
    howTo: ['Stand tall, feet together, arms at your sides.', 'Jump your feet apart while raising your arms overhead.', 'Jump back to feet together, arms back down.', 'Keep a steady rhythm.'],
    cues: [
      'Get your arms all the way overhead, not just to shoulder height',
      'Land softly on the balls of your feet each jump',
      'Keep a steady, sustainable rhythm rather than sprinting the first few',
      'Feet jump out roughly shoulder-width or a little more',
      'Keep your core lightly braced throughout',
      'Breathe rhythmically — don\'t hold your breath',
      'This is a warm-up and conditioning tool — pair it with strength work',
      'Low-impact option: step side to side instead of jumping if needed',
      'Keep your knees soft on landing, not locked straight',
      'Great as a finisher between sets of a strength circuit',
      'Consistent pace beats an all-out sprint that fades after 10 reps',
      'Make sure you have clear space around you before starting',
    ],
    angles: JACK_ANGLE, rep: { angle: 'jack', downBelow: 70, upAbove: 140 }, targetAngle: 30,
    gauge: { angle: 'jack', label: 'Arms', downBelow: 70, upAbove: 140, target: 30 },
    formRules: [],
  }),
  def({
    slug: 'mountain-climbers', name: 'Mountain Climbers', category: 'full', mode: 'reps', family: 'mountain-climbers', level: 1,
    muscles: ['core', 'quads', 'shoulders'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isProne(landmarks),
    setup: 'Film your SIDE at floor level, in a high plank. It watches whichever knee is driving in.',
    summary: 'Plank-position knee drives — a core and cardio combo.',
    howTo: ['Start in a high plank, hands under your shoulders.', 'Drive one knee toward your chest.', 'Quickly swap legs.', 'Keep your hips low and steady throughout.'],
    cues: [
      'Keep your hips low and steady — don\'t let them pike up as you drive your knees',
      'Drive your knee toward your chest, not just tapping the floor',
      'Keep your hands planted firmly under your shoulders',
      'Find a rhythm you can sustain, not just an all-out sprint',
      'Keep your core braced throughout — this is a core move disguised as cardio',
      'Land softly with each foot switch, don\'t stomp',
      'Keep your head in line with your spine, don\'t crane it up',
      'Breathe rhythmically as you go',
      'Slow it down if your hips start bouncing — control beats speed',
      'Great finisher after upper-body or core work',
      'Keep your shoulders stacked over your wrists the whole set',
      'Rest if your lower back starts to sag — that means you\'re fatiguing',
    ],
    angles: MIN_HIP, rep: { angle: 'hip', downBelow: 100, upAbove: 160 }, targetAngle: 70,
    gauge: { angle: 'hip', label: 'Drive', downBelow: 100, upAbove: 160, target: 70 },
    formRules: [
      { id: 'hips-high', bodyPart: 'torso', cue: 'Lower your hips', say: 'Your hips are piking up — bring them back in line with your shoulders.', severity: 'warn', test: ({ landmarks }) => {
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          return s != null && h != null && (s - h) > 0.1;
      }},
    ],
  }),
  def({
    slug: 'high-knees', name: 'High Knees', category: 'full', mode: 'reps', family: 'high-knees', level: 1,
    muscles: ['quads', 'hip flexors', 'calves'], view: 'front', requiredJoints: STANDING,
    setup: 'FACE the camera, standing 2–3 m back, full body in frame. It watches whichever knee is driving up.',
    summary: 'Standing, alternating knee drives at speed — a cardio and hip-flexor staple.',
    howTo: ['Stand tall.', 'Drive one knee up toward hip height.', 'Quickly swap legs, staying light on your feet.', 'Pump your arms in rhythm with your legs.'],
    cues: [
      'Drive your knees up toward hip height, not just a light jog in place',
      'Stay on the balls of your feet, light and quick',
      'Keep your chest tall, don\'t hunch forward',
      'Pump your arms in rhythm with your legs',
      'Find a sustainable pace before trying to go all-out',
      'Land softly under your hips each step, not out in front',
      'Keep your core braced to stay upright and controlled',
      'Breathe rhythmically as you go',
      'This is a great way to spike your heart rate between strength sets',
      'Keep a consistent rhythm rather than speeding up and stalling out',
      'Look straight ahead, not down at your feet',
      'Make sure you have a little space around you before starting',
    ],
    angles: MIN_HIP, rep: { angle: 'hip', downBelow: 100, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'hip', label: 'Drive', downBelow: 100, upAbove: 160, target: 90 },
    formRules: [],
  }),
];

export function getExercise(slug: string): Exercise | undefined {
  return EXERCISES.find((e) => e.slug === slug);
}

/** Next step in the same progression family (lowest level above this one). */
export function getNextProgression(ex: Exercise): Exercise | undefined {
  return EXERCISES.filter((e) => e.family === ex.family && e.level > ex.level).sort((a, b) => a.level - b.level)[0];
}

/** Previous (easier) step in the same family. */
export function getPrevProgression(ex: Exercise): Exercise | undefined {
  return EXERCISES.filter((e) => e.family === ex.family && e.level < ex.level).sort((a, b) => b.level - a.level)[0];
}
