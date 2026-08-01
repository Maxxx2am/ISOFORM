import { allVisible, jointAngle, segmentAngle, symmetricAngle } from '@/engine/angles';
import type { Landmark } from '@/pose/types';
import { L } from '@/pose/types';
import type { Exercise, ExerciseCategory, ExerciseMode, Muscle } from '@/exercises/types';

function verticalDeviation(a: Landmark, b: Landmark): number | null {
  if ((a?.visibility ?? 0) < 0.5 || (b?.visibility ?? 0) < 0.5) return null;
  return Math.abs(Math.abs(segmentAngle(a, b)) - 90);
}

/**
 * Per-frame memoization for a single-argument geometry helper keyed on the
 * landmarks array's own identity — `landmarks` is a fresh array every frame
 * (see LandmarkSmoother.smooth()), so caching by reference naturally expires
 * every frame on its own without any explicit invalidation, while still
 * de-duplicating the SAME call made by multiple formRules within one frame.
 * Several exercises now have 8-10 rules, and quite a few call the exact same
 * helper with the exact same landmarks (e.g. plank's two "elbows stacked"
 * rules both call `stackOffset(landmarks, LeftElbow, RightElbow)`, and most
 * exercises with a 'shrug' rule plus a 'legs-apart'/'knees-apart' rule both
 * end up computing torsoScale independently) — this was measured, not
 * assumed: shoulderWidth/torsoScale/shrugGap/stackOffset/hipLineDeviation
 * are each called 4-30 times across the file, several times per exercise
 * per frame.
 */
function memo1<T>(fn: (lms: Landmark[]) => T): (lms: Landmark[]) => T {
  let lastLms: Landmark[] | null = null;
  let lastValue: T | undefined;
  return (lms: Landmark[]): T => {
    if (lms !== lastLms) {
      lastLms = lms;
      lastValue = fn(lms);
    }
    return lastValue as T;
  };
}

/** y of a left/right pair using whichever side(s) the camera can see.
 *  Threshold at 0.5 for angle/form computations (where precision matters);
 *  gates use 0.3 below via a separate variant — a gate should only say "no"
 *  when it can CONFIRM you're not doing the move, never because a single
 *  landmark flickered at a weird angle. */
function pairY(lms: Landmark[], l: L, r: L, mode: 'avg' | 'min' = 'avg'): number | null {
  const pts = [lms[l], lms[r]].filter((p) => (p?.visibility ?? 0) >= 0.5);
  if (pts.length === 0) return null;
  if (mode === 'min') return Math.min(...pts.map((p) => p.y));
  return pts.reduce((s, p) => s + p.y, 0) / pts.length;
}

/** Gate-friendly variant: lower threshold (0.3) so a slightly-occluded limb
 * from bad form still passes. Gates answer "is this the right exercise?" —
 * they should fail open, not fail closed on a visibility flicker. */
function pairYGate(lms: Landmark[], l: L, r: L, mode: 'avg' | 'min' = 'avg'): number | null {
  const pts = [lms[l], lms[r]].filter((p) => (p?.visibility ?? 0) >= 0.3);
  if (pts.length === 0) return null;
  if (mode === 'min') return Math.min(...pts.map((p) => p.y));
  return pts.reduce((s, p) => s + p.y, 0) / pts.length;
}

/** Distance between the shoulders on screen — a person-size reference for
 * front-view exercises (side-view moves use torsoScale/hipLineDeviation
 * instead, since a front-on shoulder width and a profile one aren't
 * comparable scales). */
const shoulderWidth = memo1((lms: Landmark[]): number | null => {
  const ls = lms[L.LeftShoulder];
  const rs = lms[L.RightShoulder];
  if (!ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return null;
  return Math.abs(ls.x - rs.x);
});

/**
 * Clearly upside-down (side view, one visible side is enough): feet above
 * the shoulders. That's the only reliable signal — a banana arch, deeply
 * bent knees, or a tuck all keep feet above shoulders. Hips can drop below
 * shoulders in a severe arch, so hip position is NOT part of this gate.
 * Form rules + the gauge handle quality separately.
 */
function isInverted(lms: Landmark[]): boolean {
  const ankle = pairYGate(lms, L.LeftAnkle, L.RightAnkle, 'min');
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  if (ankle == null || shoulder == null) return false;
  return ankle < shoulder + 0.03;
}

/**
 * Ground-work gate (push-ups): "confirmed on the floor". On the floor the
 * hips sit at nearly the same on-screen height as the shoulders (facing the
 * camera the torso is foreshortened almost to nothing; from the side it runs
 * horizontally); standing drops them far below. The old check compared that
 * drop against a FIXED fraction of the frame (0.3) — but how big "standing"
 * reads on screen depends entirely on distance from the camera, and a full
 * body framed at 2-3m has a standing drop of only ~0.25, which PASSED as
 * "prone" and let standing arm curls drive the rep pipeline (device-
 * reported). Scale-invariant fix: measure the drop against the person's own
 * on-screen shoulder width — standing torso length is well over shoulder
 * width at any distance; a foreshortened/horizontal torso never is.
 * This ONLY decides "are you doing this move at all" — form quality (sagging,
 * piking, depth) is judged separately by formRules/hold windows so a scruffy
 * rep still gets scanned and coached instead of silently not counting.
 */
function isProne(lms: Landmark[]): boolean {
  const hip = pairYGate(lms, L.LeftHip, L.RightHip);
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  if (hip == null || shoulder == null) return false;
  const drop = Math.abs(hip - shoulder);
  const ls = lms[L.LeftShoulder];
  const rs = lms[L.RightShoulder];
  const shoulderW =
    (ls?.visibility ?? 0) >= 0.3 && (rs?.visibility ?? 0) >= 0.3 ? Math.abs(ls.x - rs.x) : null;
  const limit = Math.max(0.1, Math.min(0.18, shoulderW != null ? shoulderW * 0.9 : 0.18));
  return drop < limit;
}

/** On the bar: both wrists clearly above the shoulders (hanging). */
function isHangingOnBar(lms: Landmark[]): boolean {
  const wrist = pairYGate(lms, L.LeftWrist, L.RightWrist, 'min');
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  if (wrist == null || shoulder == null) return false;
  return wrist < shoulder - 0.06;
}

/** Feet off the floor (L-sit): ankles above the hands.
 *  Margin raised from 0.02 to 0.03 — at 0.02, a single-frame MediaPipe
 *  jitter (~1-3% of bounding box per model docs) could flip between "feet
 *  off floor" and not, resetting the L-sit/V-sit hold clock. */
function feetOffFloor(lms: Landmark[], margin = 0.03): boolean {
  const handY = pairYGate(lms, L.LeftWrist, L.RightWrist);
  const footY = pairYGate(lms, L.LeftAnkle, L.RightAnkle, 'min') ?? pairYGate(lms, L.LeftKnee, L.RightKnee, 'min');
  if (handY == null || footY == null) return false;
  return footY < handY - margin;
}

/**
 * L-sit/V-sit gate refinement (B12): `feetOffFloor` alone also passes lying
 * flat on your back with your legs raised, or sitting on a chair with hands
 * down — neither is the exercise. A real L-sit/V-sit sits UP on a support
 * (hands on the floor/parallettes), which puts the shoulders clearly above
 * the hips; lying flat keeps them at roughly the same height.
 */
function isSeatedSupport(lms: Landmark[]): boolean {
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  const hip = pairYGate(lms, L.LeftHip, L.RightHip);
  if (shoulder == null || hip == null) return false;
  return shoulder < hip - 0.03;
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
const BODYLINE_AND_KNEE = (lms: Landmark[]) => ({ ...BODYLINE(lms), ...KNEE(lms) });

/**
 * ─── KEEP IN SYNC WITH exercises.json ───
 * Every time you change a rep/hold threshold here, update the matching
 * entry in exercises.json too (at the repo root). The JSON is what users
 * actually run — it's fetched on launch and persisted to disk, so it
 * survives app restarts. The compiled constants below are only the FALLBACK:
 * they kick in on first install (before the first fetch), after a data
 * wipe, or if the GitHub fetch fails.
 *
 * Bump exercises.json's "version" number when you change anything so the
 * Settings widget shows a green "new" dot and the changelog entry surfaces.
 *
 * Changelog format in exercises.json: short title, then bullet points
 * (use "- " prefix) — one per exercise family, most important first.
 */
const PUSH_REP = { angle: 'elbow', downBelow: 110, upAbove: 148 } as const;
const PULL_REP = { angle: 'elbow', downBelow: 95, upAbove: 140 } as const;

/** Knees confirmed off the floor: both knees above a minimum screen height.
 * Returns true when it CAN confirm they're up; returns true also when knees
 * aren't visible enough to judge (never rejects on missing data alone). */
function kneesOffFloor(lms: Landmark[], floorY = 0.78): boolean {
  const lk = lms[L.LeftKnee]; const rk = lms[L.RightKnee];
  if (!lk && !rk) return true;
  const lUp = lk && lk.visibility >= 0.4 ? lk.y < floorY : null;
  const rUp = rk && rk.visibility >= 0.4 ? rk.y < floorY : null;
  if (lUp === false || rUp === false) return false;
  return true;
}

/** Hands on the floor: wrists low in frame (side view ground contact). */
function handsOnFloor(lms: Landmark[]): boolean {
  const wrist = pairYGate(lms, L.LeftWrist, L.RightWrist, 'min');
  return wrist != null && wrist > 0.6;
}

/** Body roughly horizontal (side view): shoulders and hips at similar y. */
function isHorizontal(lms: Landmark[], margin = 0.18): boolean {
  const hip = pairYGate(lms, L.LeftHip, L.RightHip);
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  if (hip == null || shoulder == null) return false;
  return Math.abs(hip - shoulder) < margin;
}

/**
 * Signed hip deviation from the shoulder→ankle line (side view): positive =
 * hip sits above the line on screen (piked), negative = below (sagging).
 * `jointAngle()`/`symmetricAngle()` alone can't distinguish these — a pike
 * and a sag bend the shoulder-hip-ankle joint the same unsigned direction —
 * so a pike-specific cue (e.g. plank's `piked` rule) needs this direct
 * geometry check instead.
 */
const hipLineDeviation = memo1((lms: Landmark[]): number | null => {
  const side = (s: L, h: L, a: L) => {
    const sh = lms[s]; const hp = lms[h]; const ak = lms[a];
    if (!sh || !hp || !ak) return null;
    if (sh.visibility < 0.5 || hp.visibility < 0.5 || ak.visibility < 0.5) return null;
    const dx = ak.x - sh.x;
    if (Math.abs(dx) < 1e-4) return null;
    const lineY = sh.y + ((hp.x - sh.x) / dx) * (ak.y - sh.y);
    return lineY - hp.y; // positive when the hip is higher on screen than the line
  };
  return side(L.LeftShoulder, L.LeftHip, L.LeftAnkle) ?? side(L.RightShoulder, L.RightHip, L.RightAnkle);
});

/** Shoulder-to-hip segment length (whichever side is visible) — a
 * person-size reference for turning a screen-space offset into a fraction of
 * the athlete's own scale, so the same threshold works close to or far from
 * the camera (same reasoning as isProne's shoulder-width scaling). */
const torsoScale = memo1((lms: Landmark[]): number | null => {
  const seg = (sh: L, hp: L) => {
    const s = lms[sh]; const h = lms[hp];
    if (!s || !h || s.visibility < 0.5 || h.visibility < 0.5) return null;
    return Math.hypot(s.x - h.x, s.y - h.y);
  };
  return seg(L.LeftShoulder, L.LeftHip) ?? seg(L.RightShoulder, L.RightHip);
});

/** Ear-to-shoulder vertical gap (whichever side is visible), as a fraction
 * of torso scale. POSITIVE and large when relaxed (ear well above the
 * shoulder, since y increases downward) — shrinks toward 0 as the shoulder
 * rises up toward the ear (shrugging). A real fault a plain "shoulder near
 * the nose" check can't reliably see (the nose moves with head tilt, not
 * shoulder position). */
const shrugGap = memo1((lms: Landmark[]): number | null => {
  const scale = torsoScale(lms);
  if (scale == null || scale < 1e-4) return null;
  const gap = (ear: L, shoulder: L) => {
    const e = lms[ear]; const s = lms[shoulder];
    if (!e || !s || e.visibility < 0.5 || s.visibility < 0.5) return null;
    return (s.y - e.y) / scale;
  };
  return gap(L.LeftEar, L.LeftShoulder) ?? gap(L.RightEar, L.RightShoulder);
});

/** How far a joint sits from being stacked directly under its shoulder
 * (whichever side is visible), as a fraction of torso scale. Direction-
 * agnostic on purpose — a side-view athlete can face either way on screen,
 * so "forward" vs "back" isn't reliably labelable, but "not stacked" is.
 * Memoized on (landmarks, jointLeft, jointRight) together — several
 * exercises call this twice per frame with the identical joint pair (e.g.
 * plank's two "elbows stacked" rules), always from adjacent formRules, so a
 * single-slot cache (not a full multi-key map) is enough to de-duplicate it. */
function stackOffsetImpl(lms: Landmark[], jointLeft: L, jointRight: L): number | null {
  const scale = torsoScale(lms);
  if (scale == null || scale < 1e-4) return null;
  const off = (j: L, sh: L) => {
    const jj = lms[j]; const s = lms[sh];
    if (!jj || !s || jj.visibility < 0.5 || s.visibility < 0.5) return null;
    return Math.abs(jj.x - s.x) / scale;
  };
  return off(jointLeft, L.LeftShoulder) ?? off(jointRight, L.RightShoulder);
}
let stackOffsetLastLms: Landmark[] | null = null;
let stackOffsetLastLeft: L | null = null;
let stackOffsetLastRight: L | null = null;
let stackOffsetLastValue: number | null = null;
function stackOffset(lms: Landmark[], jointLeft: L, jointRight: L): number | null {
  if (lms === stackOffsetLastLms && jointLeft === stackOffsetLastLeft && jointRight === stackOffsetLastRight) {
    return stackOffsetLastValue;
  }
  stackOffsetLastLms = lms;
  stackOffsetLastLeft = jointLeft;
  stackOffsetLastRight = jointRight;
  stackOffsetLastValue = stackOffsetImpl(lms, jointLeft, jointRight);
  return stackOffsetLastValue;
}

/** Superman hold gate: wrists and knees must be above a floor line — confirms
 * the athlete is actually lifting their limbs off the ground, not just laying
 * flat face-down. Uses scale-invariant margin (shoulder width) so the check
 * works at any camera distance. Returns true when it CAN confirm lift on at
 * least one side; returns true also when landmarks aren't visible enough to
 * judge (never rejects on missing data alone — the angle window handles the rest). */
function wristsKneesOffFloor(lms: Landmark[]): boolean {
  const lw = lms[L.LeftWrist]; const rw = lms[L.RightWrist];
  const lk = lms[L.LeftKnee]; const rk = lms[L.RightKnee];
  const hipY = pairY(lms, L.LeftHip, L.RightHip, 'avg');
  const sw = shoulderWidth(lms);
  const floorY = hipY != null && sw != null && sw > 1e-4 ? hipY + sw * 0.3 : 0.75;
  const wristUp = (lw && lw.visibility >= 0.4 && lw.y < floorY) || (rw && rw.visibility >= 0.4 && rw.y < floorY);
  const kneeUp = (lk && lk.visibility >= 0.4 && lk.y < floorY) || (rk && rk.visibility >= 0.4 && rk.y < floorY);
  const wristVisible = (lw && lw.visibility >= 0.4) || (rw && rw.visibility >= 0.4);
  const kneeVisible = (lk && lk.visibility >= 0.4) || (rk && rk.visibility >= 0.4);
  if ((wristVisible && !wristUp) || (kneeVisible && !kneeUp)) return false;
  return true;
}

/** Planche gate: hands on floor + body roughly horizontal + knees/feet off the floor. */
function isInPlanche(lms: Landmark[]): boolean {
  if (!handsOnFloor(lms) || !isHorizontal(lms)) return false;
  if (isInverted(lms)) return false;
  const knee = pairYGate(lms, L.LeftKnee, L.RightKnee, 'min');
  const wrist = pairYGate(lms, L.LeftWrist, L.RightWrist, 'min');
  if (knee == null || wrist == null) return false;
  return knee < wrist - 0.02;
}

/** Full planche gate: planche position with legs squeezed together.
 *  Rejects handstands and straddle-width leg positions so a straddle
 *  doesn't falsely count as a full planche hold. */
function isFullPlanche(lms: Landmark[]): boolean {
  if (!isInPlanche(lms)) return false;
  const scale = torsoScale(lms);
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (scale == null || scale < 1e-4) return true;
  if (la && ra && la.visibility >= 0.5 && ra.visibility >= 0.5) {
    if (Math.abs(la.x - ra.x) / scale > 0.3) return false;
  }
  return true;
}

/** Straddle planche gate: planche position with legs spread apart.
 *  Requires visible ankle spread to confirm the straddle position. */
function isStraddlePlanche(lms: Landmark[]): boolean {
  if (!isInPlanche(lms)) return false;
  const scale = torsoScale(lms);
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
  return Math.abs(la.x - ra.x) / scale > 0.3;
}

/** One-leg-forward gate for pistol squat: one ankle well above the other.
 *  Same side-view visibility fix as feetPlanted — requiring BOTH ankles at
 *  0.5 visibility silently disabled the pistol gate for anyone whose far
 *  ankle dipped below threshold. Now: if only one ankle is clearly visible,
 *  pass (can't verify forward-leg stance, but also can't safely reject —
 *  the secondary gate check, `knee < 155`, already confirms deep squat form). */
function oneLegForward(lms: Landmark[]): boolean {
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (!la || !ra) return false;
  const lv = la.visibility >= 0.3;
  const rv = ra.visibility >= 0.3;
  if (!lv && !rv) return false;
  if (!lv || !rv) return true;
  return Math.abs(la.y - ra.y) > 0.06;
}

/** Pistol squat sides: the LOWER ankle on screen (larger y) is the one still
 *  on the ground — the support leg. The other is the extended leg. Returns
 *  null when it can't be told apart (both ankles missing or roughly level).
 *  Only requires ONE visible ankle — from a side view the far ankle is
 *  naturally occluded, so returning null here would silently disable heel-lift
 *  and knee-forward coaching cues for anyone whose far side dips below 0.5. */
function pistolSupportSide(lms: Landmark[]): { hip: L; knee: L; ankle: L; heel: L; footIndex: L } | null {
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (!la || !ra) return null;
  const lv = la.visibility >= 0.3;
  const rv = ra.visibility >= 0.3;
  // Both clearly visible: pick the lower one (on the ground)
  if (lv && rv) {
    if (la.y > ra.y) return { hip: L.LeftHip, knee: L.LeftKnee, ankle: L.LeftAnkle, heel: L.LeftHeel, footIndex: L.LeftFootIndex };
    if (ra.y > la.y) return { hip: L.RightHip, knee: L.RightKnee, ankle: L.RightAnkle, heel: L.RightHeel, footIndex: L.RightFootIndex };
    return null;
  }
  // Only one side visible — return whichever is visible as the support leg
  if (lv) return { hip: L.LeftHip, knee: L.LeftKnee, ankle: L.LeftAnkle, heel: L.LeftHeel, footIndex: L.LeftFootIndex };
  if (rv) return { hip: L.RightHip, knee: L.RightKnee, ankle: L.RightAnkle, heel: L.RightHeel, footIndex: L.RightFootIndex };
  return null;
}

/** Heel rising off the ground, as a fraction of torso scale — the toe
 * (footIndex) stays planted while the heel comes up well past what natural
 * foot-arch geometry accounts for. Returns null (never a fault) when either
 * point isn't visible enough to judge. */
function heelLifted(lms: Landmark[], heel: L, footIndex: L): boolean | null {
  const scale = torsoScale(lms);
  const h = lms[heel]; const f = lms[footIndex];
  if (scale == null || scale < 1e-4 || !h || !f || h.visibility < 0.5 || f.visibility < 0.5) return null;
  return (f.y - h.y) / scale > 0.15;
}

/**
 * Feet planted side-by-side, not mid-stride: from a SIDE camera, a real
 * two-footed squat stance keeps both ankles at nearly the same on-screen x
 * (they're stacked front-to-back along the camera's depth axis). Walking
 * toward/away from the camera swings one leg forward each step, which
 * separates the ankles in x — and that stride, not a real squat, was what
 * was tripping the knee angle through the rep thresholds and counting a
 * phantom rep while the user got into position.
 *
 * Side-view filming (e.g. squat, pistol) naturally occludes the far ankle —
 * requiring BOTH at 0.5 visibility silently disabled tracking for every user
 * whose far-side ankle dipped below that. Now: if only one ankle is clearly
 * visible, pass (can't verify spread, but also can't reject). Only reject
 * when BOTH are confidently visible AND clearly far apart in x — a genuine
 * mid-stride or staggered stance the camera CAN actually see.
 */
function feetPlanted(lms: Landmark[], marginX = 0.15): boolean {
  const la = lms[L.LeftAnkle]; const ra = lms[L.RightAnkle];
  if (!la || !ra) return false;
  const lv = la.visibility >= 0.3;
  const rv = ra.visibility >= 0.3;
  if (!lv && !rv) return false;
  if (!lv || !rv) return true;
  return Math.abs(la.x - ra.x) < marginX;
}

/**
 * Both knees bending together, within a tolerance — a real two-footed squat
 * moves symmetrically; sitting sideways in a chair, a lunge, or a single-leg
 * movement doesn't. Only used alongside feetPlanted (B10) — on its own this
 * would also need to reject mid-stride walking, which feetPlanted already
 * handles. Returns true (don't block) when only one knee is visible — a
 * single visible leg can't disagree with itself.
 */
function kneesSymmetric(lms: Landmark[], toleranceDeg = 25): boolean {
  const lOk = allVisible(lms, [L.LeftHip, L.LeftKnee, L.LeftAnkle], 0.3);
  const rOk = allVisible(lms, [L.RightHip, L.RightKnee, L.RightAnkle], 0.3);
  if (!lOk || !rOk) return true;
  const left = jointAngle(lms[L.LeftHip], lms[L.LeftKnee], lms[L.LeftAnkle]);
  const right = jointAngle(lms[L.RightHip], lms[L.RightKnee], lms[L.RightAnkle]);
  return Math.abs(left - right) < toleranceDeg;
}

/** Torso lean off vertical, trying whichever side is visible. */
function torsoLeanDeg(lms: Landmark[]): number | null {
  return verticalDeviation(lms[L.LeftShoulder], lms[L.LeftHip]) ?? verticalDeviation(lms[L.RightShoulder], lms[L.RightHip]);
}

/**
 * Real wall sit: knees bent like sitting AND the torso stays upright (back
 * flat against the wall). Just hinging forward at the hips ("bending over")
 * also bends the knees a little, but tips the torso well off vertical —
 * that's the signal that tells the two apart.
 */
function isWallSitting(lms: Landmark[]): boolean {
  const lean = torsoLeanDeg(lms);
  const knee = minKnee(lms);
  if (lean == null || knee == null) return false;
  return lean < 25 && knee < 120;
}

const ELBOW_HIP = (lms: Landmark[]) => ({ ...ELBOW(lms), ...HIP(lms) });
/** ELBOW_HIP_BODY plus KNEE — front-lever's own angles() (ELBOW_HIP_BODY)
 * never actually produced a `knee` value, which silently dead-coded its
 * `bent-knees` rule (angles.knee was always undefined). */
const ELBOW_HIP_BODY_KNEE = (lms: Landmark[]) => ({ ...ELBOW(lms), ...HIP(lms), ...BODYLINE(lms), ...KNEE(lms) });
/** Inverted-press family (handstand / HSPU / HSPU-90 / 90° hold): elbow,
 * body line, knee, and torso lean off vertical (both-sides-aware — the
 * single-side `verticalDeviation` version handstand used to compute directly
 * silently went null for anyone filming their other side). */
const INVERTED_PRESS = (lms: Landmark[]) => ({ ...ELBOW(lms), ...BODYLINE(lms), ...KNEE(lms), lean: torsoLeanDeg(lms) });

/** Track the MORE BENT knee (min of both) — for single-leg moves like pistol.
 *  Threshold lowered to 0.3 (from 0.4) because a side-view pistol naturally
 *  occludes the far leg — requiring 0.4 on BOTH knees was a silent reject
 *  for almost every real pistol attempt. */
function minKnee(lms: Landmark[], threshold = 0.4): number | null {
  const lOk = allVisible(lms, [L.LeftHip, L.LeftKnee, L.LeftAnkle], threshold);
  const rOk = allVisible(lms, [L.RightHip, L.RightKnee, L.RightAnkle], threshold);
  const lAng = lOk ? jointAngle(lms[L.LeftHip], lms[L.LeftKnee], lms[L.LeftAnkle]) : null;
  const rAng = rOk ? jointAngle(lms[L.RightHip], lms[L.RightKnee], lms[L.RightAnkle]) : null;
  if (lAng != null && rAng != null) return Math.min(lAng, rAng);
  return lAng ?? rAng;
}
const MIN_KNEE = (lms: Landmark[]) => ({ knee: minKnee(lms) });
/** Pistol-specific: lower threshold (0.3) because the far leg is naturally
 * occluded from a side view. Standard MIN_KNEE at 0.4 silently returned null
 * for almost every real pistol attempt where the far-side hip/knee/ankle
 * dipped below 0.4 visibility. */
const MIN_KNEE_LOOSE = (lms: Landmark[]) => ({ knee: minKnee(lms, 0.3) });
const ELBOW_HIP_BODY = (lms: Landmark[]) => ({ ...ELBOW(lms), ...HIP(lms), ...BODYLINE(lms) });

/** Track the MORE DRAWN-IN hip (min of both) — for alternating-leg drills
 *  (mountain climbers, high knees) where either leg's drive should count. */
function minHip(lms: Landmark[]): number | null {
  const lOk = allVisible(lms, [L.LeftShoulder, L.LeftHip, L.LeftKnee], 0.4);
  const rOk = allVisible(lms, [L.RightShoulder, L.RightHip, L.RightKnee], 0.4);
  const lAng = lOk ? jointAngle(lms[L.LeftShoulder], lms[L.LeftHip], lms[L.LeftKnee]) : null;
  const rAng = rOk ? jointAngle(lms[L.RightShoulder], lms[L.RightHip], lms[L.RightKnee]) : null;
  if (lAng != null && rAng != null) return Math.min(lAng, rAng);
  return lAng ?? rAng;
}
const MIN_HIP = (lms: Landmark[]) => ({ hip: minHip(lms) });
const MIN_HIP_ELBOW_BODY = (lms: Landmark[]) => ({ ...MIN_HIP(lms), ...ELBOW(lms), ...BODYLINE(lms) });

/**
 * Confirmed on the dip bars/chair, not just standing: hands gripping a
 * support are near-or-above hip height (you press DOWN on something raised);
 * standing at ease has your arms hanging relaxed, wrists at or below hip
 * height. Mirrors isProne's "confirmed on the floor" / isHangingOnBar's
 * "confirmed on the bar" reasoning — an approximate proxy, not a real object
 * detector, same as every other support gate in this file.
 */
function isDipSupported(lms: Landmark[]): boolean {
  const shoulder = pairYGate(lms, L.LeftShoulder, L.RightShoulder);
  const hip = pairYGate(lms, L.LeftHip, L.RightHip);
  const wrist = pairYGate(lms, L.LeftWrist, L.RightWrist);
  if (shoulder == null || hip == null || wrist == null) return false;
  return shoulder < hip && wrist < hip - 0.02;
}

/**
 * Jumping-jack gate (B13): both sides move as a mirrored pair throughout a
 * REAL jack — feet together, feet apart, or mid-transition, the left and
 * right side are always roughly equidistant from the body's own centerline.
 * Walking, standing still while gesturing, or any single-side movement
 * breaks that symmetry. Deliberately NOT a "feet must stay close together"
 * check — an earlier version of this reasoning rejected that approach
 * because the exercise's own motion spreads both feet apart in x on every
 * single genuine rep, which a fixed-stance-width gate would wrongly reject.
 * Symmetry, not absolute spread, is what a jack always has and most
 * unrelated movement doesn't. Missing landmarks never invent a rejection —
 * only visible, clearly-asymmetric pairs fail this.
 */
function isJackSymmetric(lms: Landmark[]): boolean {
  const ls = lms[L.LeftShoulder]; const rs = lms[L.RightShoulder];
  if (!ls || !rs || ls.visibility < 0.3 || rs.visibility < 0.3) return false;
  const centerX = (ls.x + rs.x) / 2;
  const scale = Math.abs(ls.x - rs.x);
  if (scale < 1e-4) return false;
  const symmetric = (a: Landmark | undefined, b: Landmark | undefined): boolean | null => {
    if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) return null;
    return Math.abs(Math.abs(a.x - centerX) - Math.abs(b.x - centerX)) / scale < 0.6;
  };
  const checks = [symmetric(lms[L.LeftWrist], lms[L.RightWrist]), symmetric(lms[L.LeftAnkle], lms[L.RightAnkle])]
    .filter((v): v is boolean => v != null);
  if (checks.length === 0) return true;
  return checks.every(Boolean);
}

/**
 * Pseudo-angle for jumping jacks: arms at your sides reads high (like a rep
 * exercise's resting "top"), arms overhead reads low ("bottom") — so it slots
 * into the same rep-counter hysteresis as every other move. Thresholds
 * (downBelow 70 / upAbove 140 out of the 0-180 synthetic scale) are
 * deliberately forgiving rather than requiring a full "hands nearly touching
 * overhead" extension or a dead-hang return to the sides — standard form
 * guidance describes that as the target shape, but the counter only needs
 * "clearly raised" and "clearly lowered" to register a real rep, not a
 * picture-perfect one. Still no real device test of this synthetic metric
 * (no real joint it directly measures, unlike every other tracked move) —
 * worth a real-world pass once it's actually tried on a phone.
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
 * Re-exported so `registry.ts` can build GATE_REGISTRY/ANGLE_FN_REGISTRY —
 * the fixed, named lookup tables a remote exercise config selects from by
 * string key (see registry.ts's doc comment). This is what keeps a remote
 * config data-only: it names one of these already-shipped, already-reviewed
 * functions, it never contains code of its own.
 */
export {
  isProne, isHangingOnBar, feetOffFloor, isInverted, isInPlanche, oneLegForward,
  feetPlanted, isWallSitting, isDipSupported, isHorizontal, kneesOffFloor,
  wristsKneesOffFloor,
  ELBOW, KNEE, HIP, BODYLINE, ELBOW_AND_BODYLINE, HIP_AND_KNEE, MIN_KNEE, MIN_HIP,
  STANDING, ARMS, ARMS_AND_HIPS,
};

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
      // bodyLine is UNSIGNED (jointAngle can't tell a sag from a pike — both
      // bend the shoulder-hip-ankle joint the same direction), so it's only
      // used here as a direction-neutral early notice. The two REAL faults
      // (sag/pike) use hipLineDeviation instead, which is signed — that's
      // what keeps them from ever contradicting each other (the old single
      // unsigned rule could tell someone "don't sag" while they were
      // actually piking, or vice versa).
      { id: 'body-line', bodyPart: 'torso', cue: 'Straighten your body', say: 'Keep your body in one straight line.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 165 },
      { id: 'sagging-hips', bodyPart: 'torso', cue: 'Don\'t let your hips sag', say: 'Your hips are dropping — squeeze your glutes to keep a straight line.', severity: 'warn', test: ({ landmarks }) => { const d = hipLineDeviation(landmarks); return d != null && d < -0.05; } },
      { id: 'piked', bodyPart: 'torso', cue: 'Lower your hips', say: 'Your hips are riding too high — bring them down in line with your shoulders.', severity: 'warn', test: ({ landmarks }) => { const d = hipLineDeviation(landmarks); return d != null && d > 0.05; } },
      { id: 'depth', bodyPart: 'arm', cue: 'Go a little lower', say: 'Go a little lower — get your elbows to ninety.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      { id: 'elbow-flare', bodyPart: 'arm', cue: 'Tuck your elbows in', say: 'Keep your elbows at a 45-degree angle to your torso, not flared out.', severity: 'warn', test: ({ landmarks, angles }) => {
          // Only a real fault while actually bent (mid-rep) — at lockout the
          // upper arm is vertical too, so the same x-ratio reads as "flared"
          // on every single rep and this fired almost constantly (reported:
          // 1 of 34 push-ups counted "clean"). Checked on whichever side is
          // visible, not just left, and loosened — a natural 45° tuck still
          // moves the elbow out from under the shoulder more than the old
          // 1.5x ratio tolerated.
          if (angles.elbow == null || angles.elbow > 130) return false;
          const flared = (s: Landmark | undefined, e: Landmark | undefined, w: Landmark | undefined) =>
            s != null && e != null && w != null && s.visibility >= 0.5 && e.visibility >= 0.5 && w.visibility >= 0.5
              ? Math.abs(e.x - s.x) > Math.abs(w.x - e.x) * 2.2 : null;
          const left = flared(landmarks[L.LeftShoulder], landmarks[L.LeftElbow], landmarks[L.LeftWrist]);
          const right = flared(landmarks[L.RightShoulder], landmarks[L.RightElbow], landmarks[L.RightWrist]);
          // Require both visible sides to agree — a single side's jitter
          // shouldn't be enough to flag a fault on a front-facing move.
          if (left != null && right != null) return left && right;
          return left ?? right ?? false;
      }},
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'Your hands are quite wide — bring them in a bit for less shoulder strain.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 1.8;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your hands slightly', say: 'Your hands are quite narrow — widen a touch to protect your wrists and elbows.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.65;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Push up evenly with both arms', say: 'One arm is doing more work than the other — press up evenly on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 155) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'head-drop', bodyPart: 'torso', cue: 'Keep your neck neutral', say: 'Your head is dropping — keep your neck neutral, eyes just ahead of your hands.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const nose = landmarks[L.Nose];
          const shoulderY = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          if (sw == null || sw < 1e-4 || !nose || nose.visibility < 0.5 || shoulderY == null) return false;
          return nose.y - shoulderY > sw * 0.6;
      }},
      { id: 'hip-twist', bodyPart: 'torso', cue: 'Keep your hips square', say: 'Your hips are twisting — keep them square and move as one straight unit.', severity: 'warn', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (sw == null || sw < 1e-4 || !lh || !rh || lh.visibility < 0.5 || rh.visibility < 0.5) return false;
          return Math.abs(lh.y - rh.y) > sw * 0.5;
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
      { id: 'no-lockout', bodyPart: 'arm', cue: 'Lock out at the bottom', say: 'Fully extend your arms at the bottom — dead hang every rep.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow >= 130 && angles.elbow < 145 },
      // FIXED: this used to compare shoulder-to-hip Y distance — plain torso
      // length on screen, not sway — so it was true for the entire set
      // regardless of kipping (reported: "No kipping" showing on every
      // rep). Kipping bends AT the hip, swinging the lower body out from
      // under the shoulders — that's an X-axis divergence between the
      // shoulder and hip midpoints, the same signal hanging-knee-raise's
      // (correct) 'swinging' rule already uses.
      { id: 'kipping', bodyPart: 'torso', cue: 'No kipping', say: 'Use strict form — no swinging your legs or hips to gain momentum.', severity: 'warn', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (sw == null || sw < 1e-4 || !ls || !rs || !lh || !rh) return false;
          if (ls.visibility < 0.5 || rs.visibility < 0.5 || lh.visibility < 0.5 || rh.visibility < 0.5) return false;
          const midShoulderX = (ls.x + rs.x) / 2;
          const midHipX = (lh.x + rh.x) / 2;
          return Math.abs(midShoulderX - midHipX) / sw > 0.5;
      }},
      { id: 'legs-swinging', bodyPart: 'leg', cue: 'Keep your legs still', say: 'Your legs are swinging out — keep them still and braced.', severity: 'warn', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (sw == null || sw < 1e-4 || !lh || !rh || !la || !ra) return false;
          if (lh.visibility < 0.5 || rh.visibility < 0.5 || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          const midHipX = (lh.x + rh.x) / 2;
          const midAnkleX = (la.x + ra.x) / 2;
          return Math.abs(midHipX - midAnkleX) / sw > 0.6;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders first', say: 'Starting with your shoulders hunched up by your ears disengages your lats — relax and hang first.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-pull', bodyPart: 'arm', cue: 'Pull evenly with both arms', say: 'One arm is pulling more than the other — drive evenly on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 155) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'uneven-grip', bodyPart: 'arm', cue: 'Even out your grip height', say: 'One hand is noticeably higher on the bar than the other — even out your grip.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.y - rw.y) / sw > 0.4;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (sw == null || sw < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / sw > 0.4;
      }},
    ],
  }),
  def({
    slug: 'l-sit', name: 'L-Sit', category: 'core', mode: 'hold', family: 'l-sit', level: 1,
    muscles: ['core', 'triceps'], view: 'side', requiredJoints: STANDING,
    // FIXED (B12): feetOffFloor alone also passes lying flat on your back
    // with legs raised — isSeatedSupport requires the shoulders to actually
    // be up on a support, not lying down.
    gate: ({ landmarks }) => feetOffFloor(landmarks) && isSeatedSupport(landmarks),
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
    // Adds elbow (arm lockout) and bodyLine (hollow-vs-arched) to the
    // hip/knee this already tracked — neither fault was checkable before.
    angles: ELBOW_HIP_BODY_KNEE, hold: { angle: 'hip', minOk: 60, maxOk: 130 }, targetAngle: 90,
    // FIXED (B17): target (180) sat outside the gauge's own 120-160 range.
    gauge: { angle: 'hip', label: 'Compression', downBelow: 60, upAbove: 130, target: 90 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Fully extend your elbows — a bent arm means you\'re not really supporting the hold.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-legs-mild', bodyPart: 'leg', cue: 'Lock your knees', say: 'Your knees are starting to bend — lock them out straight.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 165 && angles.knee >= 150 },
      { id: 'bent-legs', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Straighten your legs — lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      // FIXED (B8): used to compare shoulder to NOSE, which also drops when
      // the head simply tilts down — a head-forward-but-not-shrugged athlete
      // got told "depress your shoulders" incorrectly. shrugGap compares the
      // shoulder to the EAR instead, which head tilt doesn't move.
      { id: 'shrug', bodyPart: 'arm', cue: 'Depress your shoulders', say: 'Push your shoulders down away from your ears — don\'t shrug.', severity: 'warn', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your gaze forward', say: 'Keep your gaze forward, not down at your feet.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.08 : false;
      }},
      { id: 'feet-low', bodyPart: 'leg', cue: 'Lift your legs higher', say: 'Your feet are barely off the floor — press down harder and lift.', severity: 'info', test: ({ landmarks }) => {
          const a = pairY(landmarks, L.LeftAnkle, L.RightAnkle, 'min');
          const w = pairY(landmarks, L.LeftWrist, L.RightWrist);
          return a != null && w != null && a > w - 0.08 && a < w + 0.02;
      }},
      { id: 'uneven-legs', bodyPart: 'leg', cue: 'Raise both legs evenly', say: 'One leg is higher than the other — raise them together.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.y - ra.y) / scale > 0.35;
      }},
    ],
  }),
  def({
    slug: 'plank', name: 'Forearm Plank', category: 'core', mode: 'hold', family: 'plank', level: 1,
    muscles: ['core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isProne(landmarks) && kneesOffFloor(landmarks),
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
    // The HOLD gate stays on the unsigned bodyLine angle (158-180) — an
    // extreme sag AND an extreme pike are both "not a valid plank", so
    // whether the clock runs deliberately doesn't need a direction. The live
    // coaching cues below DO need direction (telling someone to lift their
    // hips while they're actually piking would be exactly backwards), so
    // 'sag'/'piked' use the signed hipLineDeviation instead of this angle.
    angles: BODYLINE_AND_KNEE, hold: { angle: 'bodyLine', minOk: 158, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Line', downBelow: 158, upAbove: 180, target: 178 },
    formRules: [
      { id: 'body-line', bodyPart: 'torso', cue: 'Tighten your line', say: 'Brace your core and glutes — tighten that line from head to heels.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 168 },
      { id: 'sag', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze your glutes and lift them into line.', severity: 'warn', test: ({ landmarks }) => { const d = hipLineDeviation(landmarks); return d != null && d < -0.05; } },
      { id: 'piked', bodyPart: 'torso', cue: 'Lower your hips', say: 'You\'re piking up — bring your hips down in line with your shoulders and heels.', severity: 'warn', test: ({ landmarks }) => { const d = hipLineDeviation(landmarks); return d != null && d > 0.05; } },
      { id: 'neutral-neck', bodyPart: 'torso', cue: 'Neutral neck', say: 'Keep your neck in line with your spine — gaze at the floor, not ahead.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
      { id: 'head-drop', bodyPart: 'torso', cue: 'Don\'t let your head hang', say: 'Your head is dropping — keep it in line with your spine, not hanging down.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const nose = landmarks[L.Nose];
          const shoulderY = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          if (scale == null || scale < 1e-4 || !nose || nose.visibility < 0.5 || shoulderY == null) return false;
          return (nose.y - shoulderY) / scale > 0.5;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Push your shoulders down away from your ears instead of shrugging.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'elbows-mild', bodyPart: 'arm', cue: 'Stack your elbows under your shoulders', say: 'Slide your elbows back under your shoulders for a stronger base.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftElbow, L.RightElbow); return o != null && o > 0.4 && o <= 0.65; } },
      { id: 'elbows-not-stacked', bodyPart: 'arm', cue: 'Elbows under your shoulders', say: 'Your elbows have drifted well away from under your shoulders — stack them back underneath.', severity: 'warn', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftElbow, L.RightElbow); return o != null && o > 0.65; } },
      { id: 'knees-mild', bodyPart: 'leg', cue: 'Lock your knees', say: 'Your knees are starting to bend — lock them out straight.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 172 && angles.knee >= 155 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Straighten your legs fully — bent knees turn this into a shorter lever, not a real plank.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 155 },
    ],
  }),
  def({
    slug: 'squat', name: 'Bodyweight Squat', category: 'lower', mode: 'reps', family: 'squat', level: 1,
    muscles: ['quads', 'glutes'], view: 'side', requiredJoints: STANDING,
    // FIXED (B10): feetPlanted alone only rules out mid-stride walking — it
    // says nothing about the KNEES actually moving together, so sitting
    // sideways in a chair or any single-leg knee bend with feet stacked in x
    // could still drive the rep counter. A real two-footed squat bends both
    // knees together; requiring that closes the gap.
    gate: ({ landmarks }) => feetPlanted(landmarks) && kneesSymmetric(landmarks),
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
    // FIXED (B6): torsoLean used to read only the LEFT shoulder/hip —
    // filming from the right (equally valid for a side-view move) left it
    // permanently null, silently disabling 'chest-up' for half of users.
    // torsoLeanDeg tries whichever side is actually visible.
    angles: (lms) => ({ ...KNEE(lms), torsoLean: torsoLeanDeg(lms) }),
    // More forgiving rep thresholds — you don't need to hit ATG or full
    // lockout to register a rep, but the form rules still nudge you toward both.
    rep: { angle: 'knee', downBelow: 100, upAbove: 148 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 100, upAbove: 148, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Go lower — get your thighs to parallel.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 110 && angles.knee < 140 },
      { id: 'no-lockout', bodyPart: 'leg', cue: 'Stand all the way up', say: 'Finish the rep — lock your hips out at the top instead of stopping short.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee >= 140 && angles.knee < 160 },
      { id: 'chest-up-mild', bodyPart: 'torso', cue: 'Keep your chest tall', say: 'Start lifting your chest before you fold forward any further.', severity: 'info', test: ({ angles }) => angles.torsoLean != null && angles.knee != null && angles.knee < 150 && angles.torsoLean > 30 && angles.torsoLean <= 45 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest up and eyes forward.', severity: 'warn', test: ({ angles }) => angles.torsoLean != null && angles.knee != null && angles.knee < 150 && angles.torsoLean > 45 },
      // Side view can only measure forward/back knee travel, not inward
      // cave (that needs a front view) — the cue below is worded for what's
      // actually being watched here.
      { id: 'knee-forward-mild', bodyPart: 'leg', cue: 'Watch your knees drifting forward', say: 'Your knees are starting to travel well past your toes — sit back into your hips a bit more.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.5 && d <= 0.8;
      }},
      { id: 'knee-forward', bodyPart: 'leg', cue: 'Sit back into your hips', say: 'Your knees are traveling too far past your toes — push your hips back more.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.8;
      }},
      { id: 'heel-lift', bodyPart: 'leg', cue: 'Keep your heels down', say: 'Your heels are lifting — keep your weight through your midfoot and heel, not your toes.', severity: 'warn', test: ({ landmarks }) => {
          const l = heelLifted(landmarks, L.LeftHeel, L.LeftFootIndex);
          const r = heelLifted(landmarks, L.RightHeel, L.RightFootIndex);
          return l === true || r === true;
      }},
    ],
  }),
  def({
    slug: 'dip', name: 'Dip', category: 'upper', mode: 'reps', family: 'dip', level: 1,
    muscles: ['chest', 'triceps', 'shoulders'], view: 'side', requiredJoints: ARMS_AND_HIPS,
    gate: ({ landmarks }) => isDipSupported(landmarks),
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
    // downBelow was 118 — 28° short of target (90), a much wider gap than any
    // sibling rep exercise (squat/push-up sit ~5°) and shallower than the
    // ~90-95° trigger used by comparable open-source implementations. Tightened
    // to 108, which still sits below the 'shallow' rule's window (110-145) so a
    // rep can complete slightly before full depth and still get nagged for it.
    angles: ELBOW, rep: { angle: 'elbow', downBelow: 108, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 108, upAbove: 155, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Go a little deeper — shoulders to elbow height.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 110 && angles.elbow < 145 },
      // FIXED (B5): the old rule punished staying upright — but upright IS a
      // valid, deliberate choice (this exercise's own cues explicitly say
      // "stay upright for triceps"). Chest-vs-triceps emphasis is a real
      // technique choice, not a fault, so it's dropped rather than replaced
      // with a "correct" lean direction. What IS a real, direction-neutral
      // fault: going deeper than is comfortable for the shoulder joint.
      { id: 'too-deep', bodyPart: 'arm', cue: 'Careful going deeper than this', say: 'That\'s very deep for your shoulders — if you feel any pinching, don\'t go lower than this.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 70 },
      { id: 'no-lockout', bodyPart: 'arm', cue: 'Full lockout at the top', say: 'Press all the way to a full lockout at the top of every rep.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow >= 145 && angles.elbow < 155 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Shoulders down and back', say: 'Pull your shoulder blades down and back instead of letting them creep up.', severity: 'warn', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'legs-swinging', bodyPart: 'leg', cue: 'Keep your legs still', say: 'Keep your core tight so your legs don\'t swing.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (scale == null || scale < 1e-4 || !ls || !rs || !lh || !rh) return false;
          if (ls.visibility < 0.5 || rs.visibility < 0.5 || lh.visibility < 0.5 || rh.visibility < 0.5) return false;
          const shoulderX = (ls.x + rs.x) / 2;
          const hipX = (lh.x + rh.x) / 2;
          return Math.abs(shoulderX - hipX) / scale > 0.35;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Press evenly with both arms', say: 'One arm is pressing more than the other — press evenly on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 155) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
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
    angles: INVERTED_PRESS,
    // minOk dropped to 40 — a straight handstand is 178°, but arches and
    // slight form breaks shouldn't kill the hold clock. Only feet-on-floor
    // (fails the gate) or a deep tuck/planche collapse (drops bodyLine
    // below 130) stops the count. Form rules still flag quality separately.
    hold: { angle: 'bodyLine', minOk: 130, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Straightness', downBelow: 130, upAbove: 180, target: 178 },
    formRules: [
      // Live-only nudge; it never affects the score (holds score on straightness).
      // Only call an "arch" when the knees are straight — bent knees also drop
      // the body line, but that's a tuck, not a banana.
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten — squeeze your line', say: 'You are arching your back. Flex your abs and squeeze your legs together.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 160 && angles.knee != null && angles.knee > 140 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten and squeeze your legs', say: 'Point your toes and squeeze your legs together — no bent knees.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 140 && angles.knee >= 100 },
      { id: 'bent-knees-severe', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Your knees are badly bent — that\'s a tuck, not a handstand line.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 100 },
      { id: 'gaze', bodyPart: 'torso', cue: 'Gaze between your hands', say: 'Look between your hands — don\'t look back at the floor.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw) return false;
          if (nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.1;
      }},
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Push your arms straight', say: 'Lock your arms — a soft elbow makes balance much harder.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'not-stacked', bodyPart: 'torso', cue: 'Stack your hips over your shoulders', say: 'Your hips aren\'t stacked over your shoulders — that\'s the base of the whole balance.', severity: 'warn', test: ({ angles }) => angles.lean != null && angles.lean > 15 },
      { id: 'not-balanced', bodyPart: 'arm', cue: 'Stack your shoulders over your wrists', say: 'Your shoulders have drifted away from over your wrists — that\'s what\'s pulling you off balance.', severity: 'warn', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftShoulder, L.RightShoulder); return o != null && o > 0.4; } },
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Point your toes and squeeze your legs together for a tighter line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Push evenly through both arms', say: 'One arm is taking more of the load than the other — push evenly through both.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
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
      { id: 'feet-up', bodyPart: 'leg', cue: 'Lift your feet', say: 'Pull your feet off the floor — float.', severity: 'info', test: ({ landmarks }) => {
          // Missing data must never invent a fault — only flag when both
          // points are actually visible and the feet are confirmed low.
          const a = pairY(landmarks, L.LeftAnkle, L.RightAnkle, 'min');
          const w = pairY(landmarks, L.LeftWrist, L.RightWrist);
          return a != null && w != null && a > w - 0.02;
      }},
      { id: 'tuck-tight', bodyPart: 'leg', cue: 'Pull knees tighter', say: 'Squeeze your knees closer to your chest.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 75 && angles.hip < 100 },
      { id: 'flat-back-mild', bodyPart: 'torso', cue: 'Tighten your back flat', say: 'Start flattening your back before it becomes a real pike.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 && angles.bodyLine >= 140 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Don\'t pike — keep your back flat and parallel to the floor.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 140 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Protract, don\'t shrug', say: 'Push your shoulder blades away from your ears — protract, don\'t shrug.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is taking more of the load than the other — even out the support.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
      }},
      { id: 'knees-apart', bodyPart: 'leg', cue: 'Squeeze your knees together', say: 'Keep your knees together for a tighter, more compact tuck.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          if (scale == null || scale < 1e-4 || !lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return Math.abs(lk.x - rk.x) / scale > 0.3;
      }},
      // Unlike plank/handstand, MORE lean is correct here — the position is
      // physically impossible without leaning forward at all, so a SMALL
      // shoulder-to-wrist offset means under-leaning (not yet forward enough
      // for this progression), not good "stacking".
      { id: 'lean-more', bodyPart: 'arm', cue: 'Lean your shoulders past your hands', say: 'Lean your shoulders further forward, well past your hands.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftShoulder, L.RightShoulder); return o != null && o < 0.3; } },
      { id: 'gaze', bodyPart: 'torso', cue: 'Keep your gaze forward', say: 'Keep your neck neutral, gaze slightly forward of your hands.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw || nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.15;
      }},
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
      { id: 'flat-back-mild', bodyPart: 'torso', cue: 'Tighten your back flat', say: 'Start flattening your back before it becomes a real sag or pike.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 && angles.bodyLine >= 140 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Keep your back flat — don\'t sag or pike.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 140 },
      { id: 'feet-up', cue: 'Don\'t touch the floor', say: 'Keep your feet off the floor.', severity: 'info', test: ({ landmarks }) => {
          // Missing data must never invent a fault — only flag when both
          // points are actually visible and the feet are confirmed low.
          const a = pairY(landmarks, L.LeftAnkle, L.RightAnkle, 'min');
          const w = pairY(landmarks, L.LeftWrist, L.RightWrist);
          return a != null && w != null && a > w - 0.02;
      }},
      { id: 'hips-not-level', bodyPart: 'torso', cue: 'Level your hips with your shoulders', say: 'Your hips should sit roughly level with your shoulders at this stage — adjust the opening.', severity: 'warn', test: ({ landmarks }) => {
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          return h != null && s != null && Math.abs(h - s) > 0.12;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Protract, don\'t shrug', say: 'Push your shoulder blades away from your ears — protract, don\'t shrug.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is taking more of the load than the other — even out the support.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
      }},
      { id: 'knees-apart', bodyPart: 'leg', cue: 'Squeeze your knees together', say: 'Keep your knees together for a tighter line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          if (scale == null || scale < 1e-4 || !lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return Math.abs(lk.x - rk.x) / scale > 0.3;
      }},
      { id: 'lean-more', bodyPart: 'arm', cue: 'Lean your shoulders past your hands', say: 'Lean your shoulders further forward, well past your hands.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftShoulder, L.RightShoulder); return o != null && o < 0.3; } },
    ],
  }),
  def({
    slug: 'straddle-planche', name: 'Straddle Planche', category: 'full', mode: 'hold', family: 'planche', level: 3,
    muscles: ['shoulders', 'core', 'chest', 'back', 'glutes'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isStraddlePlanche(landmarks),
    setup: 'Film your SIDE from 2–3 m. Straddle planche — legs spread wide, body horizontal.',
    summary: 'Straddle planche hold. Legs spread for leverage, body parallel to the floor.',
    howTo: ['Spread your legs wide into a straddle.', 'Lean forward past your hands with straight arms.', 'Lift your legs to horizontal, toes pointed.', 'Hold — squeeze every muscle tight.'],
    cues: [
      'Legs spread in a wide V — not together, not tucked',
      'Body parallel to the floor, straight line from shoulders through hips',
      'Arms locked completely straight — no bend at all',
      'Point your toes and keep your knees locked',
      'Ribs pulled down, back flat — don\'t let your hips sag or pike',
      'Shoulders protracted, leaning well past your hands',
      'Hips dropping is fatigue — end the set cleanly',
      'Warm up shoulders and wrists thoroughly',
      'Keep breathing — don\'t lock your breath while straining',
      'A clean straddle is the bridge between tuck and full planche',
      'Rest 2–3 minutes between attempts — this is max-strength work',
    ],
    angles: ELBOW_HIP_BODY_KNEE, hold: { angle: 'bodyLine', minOk: 125, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Extension', downBelow: 125, upAbove: 180, target: 178 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Straight arms — don\'t bend your elbows.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Lock your knees', say: 'Keep your knees straight even with legs spread.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Keep your back flat and parallel.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 165 && angles.bodyLine >= 150 },
      { id: 'hips-low', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze glutes to lift.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Protract, don\'t shrug', say: 'Push your shoulders away from your ears.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is taking more of the load — even out.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
      }},
      { id: 'lean-more', bodyPart: 'arm', cue: 'Lean shoulders past hands', say: 'Lean your shoulders forward, well past your hands.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftShoulder, L.RightShoulder); return o != null && o < 0.3; } },
    ],
  }),
  def({
    slug: 'planche', name: 'Planche', category: 'full', mode: 'hold', family: 'planche', level: 4,
    muscles: ['shoulders', 'core', 'chest', 'back'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isFullPlanche(landmarks),
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
    // FIXED (B7): angles was ELBOW_HIP_BODY, which never produces `knee` —
    // the 'bent-knees' rule below tested against `undefined` forever.
    // FIXED (B16): gauge was copy-pasted from tuck-planche (hip 20-80,
    // target 50 — a tucked shape) onto the FULL planche, whose own hold/
    // targetAngle track bodyLine at 125-180/178. The live bar was reading a
    // tucked shape as perfect and a real full planche as failing.
    angles: ELBOW_HIP_BODY_KNEE, hold: { angle: 'bodyLine', minOk: 125, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Extension', downBelow: 125, upAbove: 180, target: 178 },
    formRules: [
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Lock your arms', say: 'Straight arms — don\'t bend your elbows.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Point your toes and squeeze your legs together.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      // flat-back (mild) and hips-low (real fault) now split the SAME metric
      // into non-overlapping bands instead of two warns on overlapping
      // ranges (145 was a strict subset of 150) — that used to double-tally
      // one deviation as two differently-worded faults.
      { id: 'flat-back', bodyPart: 'torso', cue: 'Straighten your back', say: 'Keep your back flat and parallel to the floor.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 165 && angles.bodyLine >= 150 },
      { id: 'hips-low', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your hips are sagging — squeeze your glutes to lift.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Protract, don\'t shrug', say: 'Push your shoulder blades away from your ears — protract, don\'t shrug.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is taking more of the load than the other — even out the support.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
      }},
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Point your toes and squeeze your legs together.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
      { id: 'lean-more', bodyPart: 'arm', cue: 'Lean your shoulders past your hands', say: 'Lean your shoulders further forward, well past your hands.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftShoulder, L.RightShoulder); return o != null && o < 0.3; } },
    ],
  }),
  // ───────── Front Lever path (side view, holds, bar) ─────────
  def({
    slug: 'tuck-front-lever', name: 'Tuck Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 1,
    muscles: ['back', 'core', 'biceps'], view: 'side', requiredJoints: ARMS, showBar: true,
    // isHangingOnBar alone also passes while just hanging — the hip hold
    // window (5-90°) filters this in practice (a dead hang is ~180°), but
    // requiring horizontality gives a cleaner gate that matches the exercise.
    gate: ({ landmarks }) => isHangingOnBar(landmarks) && isHorizontal(landmarks, 0.15),
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
          if (h == null || s == null) return false;
          const scale = torsoScale(landmarks);
          return scale != null && scale > 1e-4 && (h - s) / scale > 0.2;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Pull your shoulder blades down', say: 'Squeeze your shoulder blades down and back instead of shrugging up.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is more locked out than the other — even out the load on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (scale == null || scale < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / scale > 0.3;
      }},
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your neck relaxed', say: 'Keep your chin slightly tucked, not craned up.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
      { id: 'knees-apart', bodyPart: 'leg', cue: 'Squeeze your knees together', say: 'Keep your knees together for a tighter, easier tuck.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          if (scale == null || scale < 1e-4 || !lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return Math.abs(lk.x - rk.x) / scale > 0.3;
      }},
    ],
  }),
  def({
    slug: 'adv-tuck-front-lever', name: 'Advanced Tuck Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 2,
    muscles: ['back', 'core', 'biceps'], view: 'side', requiredJoints: ARMS, showBar: true,
    gate: ({ landmarks }) => isHangingOnBar(landmarks) && isHorizontal(landmarks, 0.15),
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
      { id: 'too-tucked', bodyPart: 'leg', cue: 'Open your hips a bit more', say: 'Extend your knees back a bit further than a basic tuck.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip >= 50 && angles.hip < 80 },
      { id: 'hips-dropping', bodyPart: 'torso', cue: 'Level your hips', say: 'Bring your hips level with your shoulders.', severity: 'warn', test: ({ landmarks }) => {
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          if (h == null || s == null) return false;
          const scale = torsoScale(landmarks);
          return scale != null && scale > 1e-4 && (h - s) / scale > 0.2;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Pull your shoulder blades down', say: 'Squeeze your shoulder blades down and back instead of shrugging up.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is more locked out than the other — even out the load on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (scale == null || scale < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / scale > 0.3;
      }},
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your neck relaxed', say: 'Keep your chin slightly tucked, not craned up.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
      { id: 'knees-apart', bodyPart: 'leg', cue: 'Squeeze your knees together', say: 'Keep your knees together for a tighter line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          if (scale == null || scale < 1e-4 || !lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return Math.abs(lk.x - rk.x) / scale > 0.3;
      }},
    ],
  }),
  def({
    slug: 'front-lever', name: 'Front Lever', category: 'core', mode: 'hold', family: 'front-lever', level: 3,
    muscles: ['back', 'core', 'biceps', 'shoulders'], view: 'side', requiredJoints: ARMS, showBar: true,
    // isHangingOnBar alone lets the clock run while just hanging straight down
    // — bodyLine is ~175-180° in a dead hang, which falls INSIDE the hold
    // window (125-180). Requiring the body to be roughly horizontal closes
    // this gap: a real front lever has hips and shoulders at similar screen y
    // (the body is horizontal), a dead hang drops the hips well below.
    gate: ({ landmarks }) => isHangingOnBar(landmarks) && isHorizontal(landmarks, 0.12),
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
    // FIXED (B7): this used ELBOW_HIP_BODY, which never produces a `knee`
    // value — the 'bent-knees' rule below tested `angles.knee < 160` against
    // `undefined` forever, so it could never fire. Swapped to the combinator
    // that actually includes knee.
    angles: ELBOW_HIP_BODY_KNEE, hold: { angle: 'bodyLine', minOk: 125, maxOk: 180 }, targetAngle: 178,
    gauge: { angle: 'bodyLine', label: 'Straightness', downBelow: 125, upAbove: 180, target: 178 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Lock your arms completely.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      { id: 'sag', bodyPart: 'torso', cue: 'Lift your hips', say: 'Your body is sagging — squeeze your glutes and lats to pull horizontal.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
      { id: 'hip-creep', bodyPart: 'torso', cue: 'Fight the tuck', say: 'Your hips are drawing in toward a tuck — fight to keep full extension at the hip.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip < 150 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Pull your shoulder blades down', say: 'Pull your shoulder blades down and back hard instead of shrugging up.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is more locked out than the other — even out the load on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (scale == null || scale < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / scale > 0.3;
      }},
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your neck relaxed', say: 'Keep your neck neutral, gaze forward — not down at your feet.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Point your toes and squeeze your legs together.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
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
    angles: INVERTED_PRESS,
    rep: { angle: 'elbow', downBelow: 105, upAbove: 155 }, targetAngle: 75,
    gauge: { angle: 'elbow', label: 'Depth', downBelow: 105, upAbove: 155, target: 75 },
    formRules: [
      { id: 'banana-mild', bodyPart: 'torso', cue: 'Tighten your line', say: 'Brace your abs — start tightening your line before it becomes a full arch.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 165 && angles.bodyLine >= 155 },
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch your back — squeeze your line tight.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
      { id: 'shallow', bodyPart: 'arm', cue: 'Go deeper', say: 'Lower further — a full HSPU goes well past 90°, closer to a full bend.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 115 && angles.elbow < 150 },
      { id: 'no-lockout', bodyPart: 'arm', cue: 'Lock out at the top', say: 'Press all the way to a full lockout at the top — straight arms every rep.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow >= 145 && angles.elbow < 155 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten and squeeze your legs', say: 'Point your toes and squeeze your legs together for a tighter, easier line.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 140 },
      { id: 'not-stacked', bodyPart: 'torso', cue: 'Stack your hips over your shoulders', say: 'Keep your hips stacked over your shoulders as you press — don\'t let them drift.', severity: 'warn', test: ({ angles }) => angles.lean != null && angles.lean > 15 },
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Squeeze your legs together for a tighter, easier line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Press evenly with both arms', say: 'One arm is pressing more than the other — press evenly on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 155) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'head-forward', bodyPart: 'torso', cue: 'Lower toward the floor, not forward', say: 'Lower your head toward the floor between your hands, not out in front of them.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 130) return false;
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw || nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.15;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Push your shoulders down away from your ears through the press.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
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
    angles: INVERTED_PRESS,
    rep: { angle: 'elbow', downBelow: 95, upAbove: 130 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: '90° range', downBelow: 95, upAbove: 130, target: 90 },
    formRules: [
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch your back — squeeze your line tight.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
      { id: 'too-deep', bodyPart: 'arm', cue: 'Stop at 90°', say: 'That\'s deeper than 90 — this variation stops there, it\'s not a full HSPU.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 75 },
      { id: 'locking-out', bodyPart: 'arm', cue: 'Don\'t lock out', say: 'You pressed to a full lockout — for the 90° variant, stop short of straightening all the way.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 135 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten and squeeze your legs', say: 'Point your toes and keep your legs together for a tighter, easier line.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 140 },
      { id: 'not-stacked', bodyPart: 'torso', cue: 'Stack your hips over your shoulders', say: 'Keep your hips stacked over your shoulders through the whole range.', severity: 'warn', test: ({ angles }) => angles.lean != null && angles.lean > 15 },
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Squeeze your legs together for a tighter, easier line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Press evenly with both arms', say: 'One arm is pressing more than the other — press evenly on both sides.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'head-forward', bodyPart: 'torso', cue: 'Head over your hands, not forward', say: 'Keep your head between your hands, not drifting out in front of them.', severity: 'warn', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw || nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.15;
      }},
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Push your shoulders down away from your ears through the range.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
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
    // FIXED (B20): window was 60-120 — an elbow-hold form (very bent arms)
    // falls below 60° and the clock never starts. Lowered minOk to 40 so
    // even a deep elbow-hold starts counting; form rules still flag it.
    angles: INVERTED_PRESS, hold: { angle: 'elbow', minOk: 40, maxOk: 125 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Elbow', downBelow: 40, upAbove: 125, target: 90 },
    formRules: [
      { id: 'too-bent', bodyPart: 'arm', cue: 'Straighten a bit', say: 'Your elbows are too bent — lift slightly.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 40 },
      { id: 'too-straight', bodyPart: 'arm', cue: 'Bend more', say: 'Lower your elbows to 90°.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow > 125 },
      { id: 'banana', bodyPart: 'torso', cue: 'Straighten your line', say: 'Don\'t arch — squeeze your body into a straight line.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 155 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten and squeeze your legs', say: 'Point your toes and squeeze your legs together for a cleaner line.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 140 },
      { id: 'not-stacked', bodyPart: 'torso', cue: 'Stack your hips over your shoulders', say: 'Keep your hips stacked over your shoulders — that\'s what holds the line.', severity: 'warn', test: ({ angles }) => angles.lean != null && angles.lean > 15 },
      { id: 'legs-apart', bodyPart: 'leg', cue: 'Squeeze your legs together', say: 'Squeeze your legs together for a cleaner line.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / scale > 0.3;
      }},
      { id: 'uneven-arms', bodyPart: 'arm', cue: 'Even out both arms', say: 'One arm is taking more of the load than the other — even out the hold.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 20;
      }},
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your neck neutral', say: 'Keep your neck neutral, gaze between your hands.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (!nose || !lw || !rw || nose.visibility < 0.5 || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          const handX = (lw.x + rw.x) / 2;
          return Math.abs(nose.x - handX) > 0.15;
      }},
    ],
  }),
  // ───────── V-Sit path (side view) ─────────
  def({
    slug: 'l-to-v-raises', name: 'L→V Raises', category: 'core', mode: 'reps', family: 'l-sit', level: 2,
    muscles: ['core', 'triceps', 'hip flexors'], view: 'side', requiredJoints: STANDING,
    // FIXED (B12): same reasoning as L-sit/V-sit — require sitting up on the
    // support, not lying flat with legs raised.
    gate: ({ landmarks }) => feetOffFloor(landmarks) && isSeatedSupport(landmarks),
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
    // FIXED (B3): downBelow/upAbove (100/140) were both ABOVE a resting
    // L-sit's own hip angle (~90) — raising legs toward a V CLOSES the hip
    // angle further (toward v-sit's ~40-70), it doesn't open it, so the rep
    // could never cross either threshold in the direction the movement
    // actually goes. Rebuilt around the real range: L-sit (~90, top/reset)
    // down to a real V (~65, bottom/contraction) and back.
    angles: ELBOW_HIP_BODY_KNEE, rep: { angle: 'hip', downBelow: 65, upAbove: 95 }, targetAngle: 50,
    gauge: { angle: 'hip', label: 'Height', downBelow: 65, upAbove: 95, target: 50 },
    formRules: [
      { id: 'bent-legs-mild', bodyPart: 'leg', cue: 'Lock your knees', say: 'Your knees are starting to bend — lock them out straight.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 165 && angles.knee >= 150 },
      { id: 'bent-legs', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees and point your toes.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      { id: 'low', bodyPart: 'leg', cue: 'Lift higher', say: 'Lift your legs closer to vertical, toward a real V.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 65 && angles.hip < 90 },
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Press through straight arms', say: 'Press down through straight arms — don\'t let your elbows bend as you lift.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Keep your shoulders down, away from your ears.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-legs', bodyPart: 'leg', cue: 'Raise both legs evenly', say: 'One leg is higher than the other — lift them together.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.y - ra.y) / scale > 0.35;
      }},
    ],
  }),
  def({
    slug: 'v-sit', name: 'V-Sit', category: 'core', mode: 'hold', family: 'l-sit', level: 3,
    muscles: ['core', 'triceps', 'hip flexors', 'quads'], view: 'side', requiredJoints: STANDING,
    // FIXED (B12): same reasoning as L-sit — require sitting up on the
    // support, not lying flat with legs raised.
    gate: ({ landmarks }) => feetOffFloor(landmarks) && isSeatedSupport(landmarks),
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
    // FIXED (B2): hold window (95-180) and 'not-high-enough' (hip < 120)
    // both accepted/rewarded a NEAR-STRAIGHT hip angle — i.e. lying flat,
    // barely a raise — while a real V-sit closes the hip angle toward
    // ~40-70°. The old cue fired exactly when form WAS good and went silent
    // exactly when it wasn't — precisely backwards. Rebuilt around the real
    // V-sit range.
    angles: ELBOW_HIP_BODY_KNEE, hold: { angle: 'hip', minOk: 30, maxOk: 75 }, targetAngle: 50,
    gauge: { angle: 'hip', label: 'Openness', downBelow: 40, upAbove: 70, target: 50 },
    formRules: [
      { id: 'bent-knees-mild', bodyPart: 'leg', cue: 'Lock your knees', say: 'Your knees are starting to bend — lock them out straight.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 165 && angles.knee >= 150 },
      { id: 'bent-knees', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Lock your knees — no bending.', severity: 'warn', test: ({ angles }) => angles.knee != null && angles.knee < 150 },
      { id: 'not-high-enough', bodyPart: 'leg', cue: 'Lift your legs higher', say: 'Bring your legs closer to vertical, toward a real V.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 75 && angles.hip < 100 },
      { id: 'locked-arms', bodyPart: 'arm', cue: 'Press through straight arms', say: 'Press down through straight arms to support the hold.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Keep your shoulders down away from your ears.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'uneven-legs', bodyPart: 'leg', cue: 'Hold both legs evenly', say: 'One leg is higher than the other — hold them together.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.y - ra.y) / scale > 0.35;
      }},
    ],
  }),
  // ───────── Pistol Squat path (side view) ─────────
  def({
    slug: 'pistol', name: 'Pistol Squat', category: 'lower', mode: 'reps', family: 'pistol', level: 3,
    muscles: ['quads', 'glutes', 'core', 'hamstrings'], view: 'side', requiredJoints: STANDING,
    // FIXED (B11): oneLegForward alone (one ankle well above the other)
    // passes during ordinary standing/walking too — mid-stride, one foot is
    // always higher than the other for a beat. Requiring the support leg's
    // knee to already be meaningfully bent ties the gate to someone actually
    // sitting down on one leg, not just standing with a foot lifted.
    gate: ({ landmarks, angles }) => oneLegForward(landmarks) && angles.knee != null && angles.knee < 130,
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
    // FIXED (B6): torsoLean used to read only the LEFT shoulder/hip.
    // MIN_KNEE_LOOSE uses visibility threshold 0.3 instead of 0.4 — a
    // side-view pistol naturally occludes the far leg, so the standard
    // threshold silently returned null for most real attempts.
    angles: (lms) => ({ ...MIN_KNEE_LOOSE(lms), torsoLean: torsoLeanDeg(lms) }),
    // FIXED (B15): downBelow was 128 — barely a quarter-squat on one leg, and
    // far shallower than the exercise's own cue ("hamstring to calf, every
    // single rep"). Deepened to 100, matching the regular squat's own
    // downBelow — a pistol's bottom should be at least as deep as a
    // two-legged squat, not shallower.
    rep: { angle: 'knee', downBelow: 100, upAbove: 160 }, targetAngle: 75,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 100, upAbove: 160, target: 75 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go deeper', say: 'Squat all the way — hamstring to calf.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 110 && angles.knee < 145 },
      { id: 'no-lockout', bodyPart: 'leg', cue: 'Stand all the way up', say: 'Finish the rep — lock your support leg out at the top.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee >= 150 && angles.knee < 160 },
      { id: 'extended-leg-bent', bodyPart: 'leg', cue: 'Straighten your extended leg', say: 'Keep your front leg locked straight — foot off the floor.', severity: 'warn', test: ({ landmarks }) => {
          const support = pistolSupportSide(landmarks);
          if (!support) return false;
          const side = support.hip === L.LeftHip ? 'left' : 'right';
          const extHip = side === 'left' ? L.RightHip : L.LeftHip;
          const extKnee = side === 'left' ? L.RightKnee : L.LeftKnee;
          const extAnkle = side === 'left' ? L.RightAnkle : L.LeftAnkle;
          if (!allVisible(landmarks, [extHip, extKnee, extAnkle], 0.3)) return false;
          return jointAngle(landmarks[extHip], landmarks[extKnee], landmarks[extAnkle]) < 150;
      }},
      { id: 'chest-up-mild', bodyPart: 'torso', cue: 'Keep your chest tall', say: 'Start lifting your chest before you fold forward any further.', severity: 'info', test: ({ angles }) => angles.torsoLean != null && angles.torsoLean > 25 && angles.torsoLean <= 35 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest proud and back straight.', severity: 'warn', test: ({ angles }) => angles.torsoLean != null && angles.torsoLean > 35 },
      { id: 'leg-touching', bodyPart: 'leg', cue: 'Keep that leg lifted', say: 'Your extended leg is drifting down toward the floor — keep it lifted the whole rep.', severity: 'warn', test: ({ landmarks }) => {
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (!la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.y - ra.y) < 0.1;
      }},
      { id: 'heel-lift', bodyPart: 'leg', cue: 'Keep your heel down', say: 'Your support heel is lifting — keep your weight through your midfoot and heel, not your toes.', severity: 'warn', test: ({ landmarks }) => {
          const side = pistolSupportSide(landmarks);
          if (!side) return false;
          return heelLifted(landmarks, side.heel, side.footIndex) === true;
      }},
      { id: 'knee-forward-mild', bodyPart: 'leg', cue: 'Watch your knee drifting forward', say: 'Your support knee is starting to travel well past your toes.', severity: 'info', test: ({ landmarks }) => {
          const side = pistolSupportSide(landmarks);
          const scale = torsoScale(landmarks);
          if (!side || scale == null || scale < 1e-4) return false;
          const k = landmarks[side.knee]; const a = landmarks[side.ankle];
          if (!k || !a || k.visibility < 0.5 || a.visibility < 0.5) return false;
          const d = Math.abs(k.x - a.x) / scale;
          return d > 0.5 && d <= 0.8;
      }},
      { id: 'knee-forward', bodyPart: 'leg', cue: 'Sit back into your hip', say: 'Your support knee is traveling too far past your toes — sit back into your hip more.', severity: 'warn', test: ({ landmarks }) => {
          const side = pistolSupportSide(landmarks);
          const scale = torsoScale(landmarks);
          if (!side || scale == null || scale < 1e-4) return false;
          const k = landmarks[side.knee]; const a = landmarks[side.ankle];
          if (!k || !a || k.visibility < 0.5 || a.visibility < 0.5) return false;
          return Math.abs(k.x - a.x) / scale > 0.8;
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
    angles: (lms) => ({ ...KNEE(lms), ...HIP(lms), ...ELBOW(lms) }),
    // FIXED (B18): upAbove was 90 — the rep completed when the hips barely
    // returned to horizontal (thighs parallel to the floor), giving credit
    // for a partial lower. The exercise's own cues say "lower with control to
    // a full, straight-arm hang" and "a dead hang between reps." Raised to
    // 130 so the user must lower at least well past horizontal toward the
    // full hang (~180°), not just to a 90° halfway point.
    rep: { angle: 'hip', downBelow: 60, upAbove: 155 }, targetAngle: 40,
    gauge: { angle: 'hip', label: 'Compression', downBelow: 60, upAbove: 155, target: 40 },
    formRules: [
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Straight arms', say: 'Keep your arms locked at the bottom.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'partial', bodyPart: 'leg', cue: 'Knees higher', say: 'Raise your knees above your hips.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 70 && angles.hip < 140 },
      { id: 'swinging', bodyPart: 'torso', cue: 'Stop swinging', say: 'Control the movement — no momentum.', severity: 'warn', test: ({ landmarks }) => {
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const lh = landmarks[L.LeftHip]; const rh = landmarks[L.RightHip];
          if (!ls || !rs || !lh || !rh) return false;
          // FROM A BAR the far shoulder/hip are behind the body and frequently
          // read with very low visibility — using those positions for a
          // midpoint calculation would be pure noise. Only include a landmark
          // in the midpoint when it's actually confidently visible.
          const sx: number[] = [];
          if (ls.visibility >= 0.5) sx.push(ls.x);
          if (rs.visibility >= 0.5) sx.push(rs.x);
          const hx: number[] = [];
          if (lh.visibility >= 0.5) hx.push(lh.x);
          if (rh.visibility >= 0.5) hx.push(rh.x);
          if (sx.length === 0 || hx.length === 0) return false;
          const shoulderX = sx.reduce((a, b) => a + b, 0) / sx.length;
          const hipX = hx.reduce((a, b) => a + b, 0) / hx.length;
          return Math.abs(shoulderX - hipX) > 0.15;
      }},
      // knee is computed above but nothing read it — a kicked-up straight leg
      // (using momentum) vs a curled tuck both raise the hip angle the same
      // way, so this is the only signal that tells them apart.
      { id: 'not-tucking', bodyPart: 'leg', cue: 'Curl your knees, don\'t kick', say: 'Curl your knees up rather than kicking your legs up straight.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 140 && angles.hip != null && angles.hip < 90 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Push your shoulders down away from your ears — hang, don\'t shrug.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-raise', bodyPart: 'leg', cue: 'Raise both knees evenly', say: 'One knee is rising higher than the other — raise them together.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const rk = landmarks[L.RightKnee];
          if (scale == null || scale < 1e-4 || !lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return false;
          return Math.abs(lk.y - rk.y) / scale > 0.35;
      }},
      { id: 'neck-crane', bodyPart: 'torso', cue: 'Keep your neck relaxed', say: 'Don\'t crane your neck looking down at your knees — keep it relaxed and in line.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (scale == null || scale < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / scale > 0.3;
      }},
    ],
  }),
  // ───────── Muscle-Up path (front view) ─────────
  def({
    slug: 'muscle-up', name: 'Muscle-Up', category: 'upper', mode: 'reps', family: 'muscle-up', level: 3,
    muscles: ['back', 'triceps', 'shoulders', 'chest', 'core'], view: 'front', requiredJoints: ARMS, showBar: true,
    // FIXED (B16): isHangingOnBar alone is false during the support (top)
    // position — you're pressing DOWN on the bar, not hanging from it — so
    // the gate closes during the most critical phase of the muscle-up: the
    // support. The rep counter survives that brief gap (REP_BREAK_MS = 2500ms)
    // but NO form rules evaluate during support — the lockout, banana, and all
    // top-position coaching was silently dead. isDipSupported catches the
    // support phase (shoulders above hips, wrists near hip height pressing
    // down), so the gate stays open through the full hang→transition→support
    // cycle.
    gate: ({ landmarks }) => isHangingOnBar(landmarks) || isDipSupported(landmarks),
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
    angles: ELBOW_AND_BODYLINE, rep: { angle: 'elbow', downBelow: 85, upAbove: 155 }, targetAngle: 90,
    gauge: { angle: 'elbow', label: 'Pull depth', downBelow: 85, upAbove: 155, target: 90 },
    formRules: [
      { id: 'no-transition', bodyPart: 'arm', cue: 'Punch through the transition', say: 'Rotate your elbows over the bar as you reach the top of your pull.', severity: 'warn', test: ({ landmarks, angles }) => {
          // Only during an active pull (elbow meaningfully bent) — otherwise
          // this was true for the entire dead hang between reps too, since a
          // straight-arm hang also has wrists well below shoulders.
          if (angles.elbow == null || angles.elbow > 140) return false;
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (!lw || !rw || !ls || !rs) return false;
          const wristY = Math.min(lw.y, rw.y);
          const shoulderY = Math.min(ls.y, rs.y);
          // If wrists are well below shoulders (fail transition) while elbows are bent
          return wristY > shoulderY + 0.08;
      }},
      { id: 'catch-low', bodyPart: 'arm', cue: 'Pull higher before you turn over', say: 'You\'re catching the transition too low — pull higher before rotating over the bar.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow > 95 && angles.elbow < 130 },
      { id: 'no-lockout', bodyPart: 'arm', cue: 'Full lockout at the top', say: 'Press all the way to a full lockout at the top of the support.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow >= 130 && angles.elbow < 150 },
      { id: 'banana', bodyPart: 'torso', cue: 'Keep your body tight', say: 'Keep your line tight through the pull — don\'t let your back arch.', severity: 'warn', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 150 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders first', say: 'Starting with your shoulders hunched up disengages your lats — relax and hang first.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'hands-wide', bodyPart: 'arm', cue: 'Bring your hands in slightly', say: 'A very wide grip adds shoulder strain and a harder turnover — just outside shoulder width is plenty.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw > 2.2;
      }},
      { id: 'hands-narrow', bodyPart: 'arm', cue: 'Widen your grip slightly', say: 'A very narrow grip strains your wrists through the turnover — widen to just outside shoulder width.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.x - rw.x) / sw < 0.9;
      }},
      { id: 'uneven-pull', bodyPart: 'arm', cue: 'Pull evenly with both arms', say: 'One arm is leading the pull and turnover — drive evenly on both sides to protect your shoulder.', severity: 'warn', test: ({ landmarks, angles }) => {
          if (angles.elbow == null || angles.elbow > 155) return false;
          const le = landmarks[L.LeftElbow]; const re = landmarks[L.RightElbow];
          if (!allVisible(landmarks, [L.LeftShoulder, L.LeftElbow, L.LeftWrist, L.RightShoulder, L.RightElbow, L.RightWrist], 0.5) || !le || !re) return false;
          const left = jointAngle(landmarks[L.LeftShoulder], le, landmarks[L.LeftWrist]);
          const right = jointAngle(landmarks[L.RightShoulder], re, landmarks[L.RightWrist]);
          return Math.abs(left - right) > 25;
      }},
      { id: 'uneven-grip', bodyPart: 'arm', cue: 'Even out your grip height', say: 'One hand is noticeably higher on the bar than the other — even out your grip.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          if (sw == null || sw < 1e-4 || !lw || !rw || lw.visibility < 0.5 || rw.visibility < 0.5) return false;
          return Math.abs(lw.y - rw.y) / sw > 0.4;
      }},
      { id: 'shoulder-tilt', bodyPart: 'torso', cue: 'Keep your shoulders level', say: 'You\'re rotating unevenly around the bar — keep your shoulders level.', severity: 'warn', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (sw == null || sw < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / sw > 0.4;
      }},
    ],
  }),
  def({
    slug: 'wall-sit', name: 'Wall Sit', category: 'lower', mode: 'hold', family: 'wall-sit', level: 1,
    muscles: ['quads', 'glutes'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isWallSitting(landmarks),
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
      // FIXED: research is explicit that pressing your hands on your thighs
      // is a common mistake — it takes load off the legs and makes the hold
      // easier than it should be, the opposite of what this line said.
      'Arms relaxed at your sides — don\'t press down on your thighs, it takes load off your legs',
      'Build time gradually — add 5–10s per week rather than chasing a max hold',
      'If your knees ache, check they aren\'t pushed forward past your toes',
      'A shaky finish is normal — that\'s near-failure, not a sign of doing it wrong',
      'Rest fully between attempts if you\'re doing more than one',
    ],
    angles: (lms) => ({ ...KNEE(lms), torsoLean: torsoLeanDeg(lms) }),     hold: { angle: 'knee', minOk: 60, maxOk: 105 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Angle', downBelow: 70, upAbove: 105, target: 90 },
    formRules: [
      { id: 'too-high', bodyPart: 'leg', cue: 'Sit lower', say: 'Slide down until your thighs are parallel to the floor.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 105 },
      // FIXED (B19): threshold (65) left a dead zone between it and the
      // hold's own minOk (60) — credited AND corrected with no explanation
      // for why the clock would stop just below it. Aligned to the same 60.
      { id: 'too-low', bodyPart: 'leg', cue: 'Come up slightly', say: 'You\'re below parallel — rise a touch to protect your knees.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 60 },
      { id: 'back-off-wall-mild', bodyPart: 'torso', cue: 'Keep your back on the wall', say: 'Your back is starting to lift off the wall — press it flat again.', severity: 'info', test: ({ angles }) => angles.torsoLean != null && angles.torsoLean > 15 && angles.torsoLean <= 25 },
      { id: 'back-off-wall', bodyPart: 'torso', cue: 'Press your back flat against the wall', say: 'Your back has come off the wall — press it flat for a safer, more effective hold.', severity: 'warn', test: ({ angles }) => angles.torsoLean != null && angles.torsoLean > 25 },
      { id: 'knee-forward-mild', bodyPart: 'leg', cue: 'Watch your knees drifting forward', say: 'Your knees are starting to travel past your toes.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.35 && d <= 0.55;
      }},
      { id: 'knee-forward', bodyPart: 'leg', cue: 'Knees over your ankles', say: 'Your knees have traveled past your toes — walk your feet out further from the wall.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.55;
      }},
    ],
  }),
  def({
    slug: 'jump-squat', name: 'Jump Squat', category: 'lower', mode: 'reps', family: 'squat', level: 2,
    muscles: ['quads', 'glutes', 'calves'], view: 'side', requiredJoints: STANDING,
    // Same B10 reasoning as squat — require both knees moving together, not
    // just feet planted, so a single-leg movement with feet stacked in x
    // can't drive the counter. Tighter feet-planted margin (0.12 vs squat's
    // 0.15) because a jump stance is narrower than a walking stride but still
    // needs to reject that single step that was counting phantom reps.
    gate: ({ landmarks }) => feetPlanted(landmarks, 0.12) && kneesSymmetric(landmarks),
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
    // Heel-lift isn't tracked here (unlike the regular squat) — heels
    // leaving the ground is expected and correct during the jump itself,
    // not a fault, so porting that check over would contradict the move.
    angles: (lms) => ({ ...KNEE(lms), torsoLean: torsoLeanDeg(lms) }),
    rep: { angle: 'knee', downBelow: 100, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'knee', label: 'Depth', downBelow: 100, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Go lower', say: 'Load the squat deeper before you explode up.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee > 125 && angles.knee < 150 },
      { id: 'chest-up-mild', bodyPart: 'torso', cue: 'Keep your chest tall', say: 'Start lifting your chest before you fold forward any further.', severity: 'info', test: ({ angles }) => angles.torsoLean != null && angles.knee != null && angles.knee < 150 && angles.torsoLean > 30 && angles.torsoLean <= 45 },
      { id: 'chest-up', bodyPart: 'torso', cue: 'Chest up', say: 'Keep your chest up as you load the jump — don\'t collapse forward.', severity: 'warn', test: ({ angles }) => angles.torsoLean != null && angles.knee != null && angles.knee < 150 && angles.torsoLean > 45 },
      { id: 'knee-forward-mild', bodyPart: 'leg', cue: 'Watch your knees drifting forward', say: 'Your knees are starting to travel well past your toes — sit back into your hips a bit more.', severity: 'info', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.5 && d <= 0.8;
      }},
      { id: 'knee-forward', bodyPart: 'leg', cue: 'Sit back into your hips', say: 'Your knees are traveling too far past your toes as you load — push your hips back more.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const lk = landmarks[L.LeftKnee]; const la = landmarks[L.LeftAnkle];
          const rk = landmarks[L.RightKnee]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4) return false;
          const off = (k: Landmark | undefined, a: Landmark | undefined) => k != null && a != null && k.visibility >= 0.5 && a.visibility >= 0.5 ? Math.abs(k.x - a.x) / scale : null;
          const l = off(lk, la); const r = off(rk, ra);
          const d = l != null && r != null ? Math.max(l, r) : (l ?? r);
          return d != null && d > 0.8;
      }},
    ],
  }),
  def({
    slug: 'superman-hold', name: 'Superman Hold', category: 'core', mode: 'hold', family: 'superman', level: 1,
    muscles: ['back', 'glutes', 'core'], view: 'side', requiredJoints: STANDING,
    gate: ({ landmarks }) => isHorizontal(landmarks, 0.2) && wristsKneesOffFloor(landmarks),
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
    angles: (lms) => ({ ...HIP(lms), ...ELBOW(lms), ...KNEE(lms) }),
    // maxOk tightened from 176 to 170 — laying completely flat on the ground
    // with arms and legs down still read ~172-176° (nearly straight) and was
    // counting phantom hold time. A real superman lift is well below this.
    hold: { angle: 'hip', minOk: 130, maxOk: 170 }, targetAngle: 160,
    // Previously had no gauge at all.
    gauge: { angle: 'hip', label: 'Lift', downBelow: 145, upAbove: 176, target: 160 },
    formRules: [
      // Kept as pre-hold guidance (fires while too flat to count yet) — this
      // was the exercise's ONLY cue, meaning zero live feedback ever fired
      // during an actual hold. The rules below fix that.
      { id: 'flat', bodyPart: 'torso', cue: 'Lift higher', say: 'Lift your chest and legs higher off the floor.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 170 },
      // "Only need a few inches — overdoing it pinches the lower back" is
      // literally this exercise's own static cue; this catches the excessive
      // end of the hold window as a real, live fault instead of silently
      // crediting time for a risky hyperextension.
      { id: 'overextending-mild', bodyPart: 'torso', cue: 'Ease off the height', say: 'You\'re starting to overextend — this only needs a small, controlled lift.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip < 155 && angles.hip >= 145 },
      { id: 'overextending', bodyPart: 'torso', cue: 'Lift less, not more', say: 'That\'s more extension than this needs — ease off before it pinches your lower back.', severity: 'warn', test: ({ angles }) => angles.hip != null && angles.hip < 145 },
      { id: 'uneven-lift', bodyPart: 'torso', cue: 'Lift both sides evenly', say: 'One side is lifting higher than the other — lift evenly on both.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          if (scale == null || scale < 1e-4 || !ls || !rs || ls.visibility < 0.5 || rs.visibility < 0.5) return false;
          return Math.abs(ls.y - rs.y) / scale > 0.3;
      }},
      { id: 'neck', bodyPart: 'torso', cue: 'Keep your neck neutral', say: 'Keep your neck neutral — don\'t crane your head up to look forward.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.08 : false;
      }},
      { id: 'arms-not-reaching', bodyPart: 'arm', cue: 'Reach your arms long', say: 'Reach your arms out long instead of bending them.', severity: 'info', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'legs-bent', bodyPart: 'leg', cue: 'Reach your legs long', say: 'Keep your legs straight and long instead of bending your knees.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
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
    angles: (lms) => ({ ...HIP(lms), ...KNEE(lms) }), rep: { angle: 'hip', downBelow: 100, upAbove: 160 }, targetAngle: 90,
    gauge: { angle: 'hip', label: 'Height', downBelow: 100, upAbove: 160, target: 90 },
    formRules: [
      { id: 'shallow', bodyPart: 'leg', cue: 'Lift higher', say: 'Lift your legs closer to vertical.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 120 && angles.hip < 150 },
      { id: 'no-lockout', bodyPart: 'leg', cue: 'Lower all the way', say: 'Lower all the way, just short of the floor, instead of stopping short.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip >= 150 && angles.hip < 160 },
      // Info, not warn — the exercise's own tips explicitly allow bending
      // the knees slightly if straight legs force the back to arch, so this
      // is a gentle nudge, not a hard fault the way it is elsewhere.
      { id: 'legs-bent', bodyPart: 'leg', cue: 'Straighten your legs', say: 'Keep your legs straighter if you can do it without your back arching.', severity: 'info', test: ({ angles }) => angles.knee != null && angles.knee < 160 },
      { id: 'uneven-legs', bodyPart: 'leg', cue: 'Raise both legs evenly', say: 'One leg is higher than the other — raise them together.', severity: 'warn', test: ({ landmarks }) => {
          const scale = torsoScale(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (scale == null || scale < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.y - ra.y) / scale > 0.35;
      }},
    ],
  }),
  def({
    slug: 'jumping-jack', name: 'Jumping Jack', category: 'full', mode: 'reps', family: 'jumping-jack', level: 1,
    muscles: ['quads', 'calves', 'shoulders'], view: 'front', requiredJoints: STANDING,
    // FIXED (B13): previously left entirely ungated — feetPlanted (built for
    // a SIDE-view stacked-depth stance) is the wrong tool here since a
    // jack's whole motion spreads both feet apart in x on every genuine rep,
    // which would trip a "feet must stay close together" check constantly.
    // isJackSymmetric checks the right thing instead: both sides moving as a
    // mirrored pair, which a real jack always has and unrelated movement
    // (walking, gesturing) generally doesn't.
    gate: ({ landmarks }) => isJackSymmetric(landmarks),
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
    // Deliberately conservative — jackAngle itself is a synthetic, not yet
    // device-validated metric (see its own doc comment), so these two rules
    // lean on more directly reliable raw landmarks instead of compounding
    // uncertainty on top of it. A fuller set (e.g. "knees soft on landing")
    // isn't included: jacks are mostly straight-legged by nature, so a naive
    // knee-angle check would fire almost constantly, the same always-on
    // failure mode the push-up elbow-flare bug already taught this app once.
    formRules: [
      { id: 'arms-not-overhead', bodyPart: 'arm', cue: 'Reach your arms all the way overhead', say: 'Get your arms all the way overhead, not just to shoulder height.', severity: 'info', test: ({ landmarks }) => {
          const lw = landmarks[L.LeftWrist]; const rw = landmarks[L.RightWrist];
          const ls = landmarks[L.LeftShoulder]; const rs = landmarks[L.RightShoulder];
          const nose = landmarks[L.Nose];
          if (!lw || !rw || !ls || !rs || !nose) return false;
          if (lw.visibility < 0.5 || rw.visibility < 0.5 || ls.visibility < 0.5 || rs.visibility < 0.5 || nose.visibility < 0.5) return false;
          const wristY = Math.min(lw.y, rw.y);
          const shoulderY = (ls.y + rs.y) / 2;
          // Raised (mid-to-top of the rep) but not yet above head height.
          return wristY < shoulderY - 0.05 && wristY > nose.y + 0.03;
      }},
      { id: 'feet-too-wide', bodyPart: 'leg', cue: 'Land a little narrower', say: 'Feet roughly shoulder-width apart or a little more — that jump is wider than it needs to be.', severity: 'info', test: ({ landmarks }) => {
          const sw = shoulderWidth(landmarks);
          const la = landmarks[L.LeftAnkle]; const ra = landmarks[L.RightAnkle];
          if (sw == null || sw < 1e-4 || !la || !ra || la.visibility < 0.5 || ra.visibility < 0.5) return false;
          return Math.abs(la.x - ra.x) / sw > 2.5;
      }},
    ],
  }),
  def({
    slug: 'mountain-climbers', name: 'Mountain Climbers', category: 'full', mode: 'reps', family: 'mountain-climbers', level: 1,
    muscles: ['core', 'quads', 'shoulders'],
    // FIXED (B17): from side view `minHip` can only track the near-side knee
    // drive — when the far knee drives in, the near leg stays straight at
    // ~180° and the rep counter never sees the hip angle change, missing ~50%
    // of reps. Front view makes BOTH knees visible so every knee drive counts.
    view: 'front', requiredJoints: STANDING,
    gate: ({ landmarks }) => isProne(landmarks),
    setup: 'FACE the camera at floor level, in a high plank. It watches both knees driving in — one after the other.',
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
    // FIXED (B22): upAbove was 170 — the hip needs to open almost completely
    // straight (~170°) between knee drives, which in a plank position with
    // slightly elevated hips is biomechanically nearly impossible. Lowered to
    // 150 so a natural plank-hip position between drives registers a rep
    // completion without forcing an unnaturally flat hip extension.
    angles: MIN_HIP_ELBOW_BODY,     rep: { angle: 'hip', downBelow: 80, upAbove: 150 }, targetAngle: 70,
    gauge: { angle: 'hip', label: 'Drive', downBelow: 80, upAbove: 150, target: 70 },
    formRules: [
      { id: 'hips-high-mild', bodyPart: 'torso', cue: 'Keep your hips down', say: 'Your hips are starting to ride up — keep them level with your shoulders.', severity: 'info', test: ({ landmarks }) => {
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          if (s == null || h == null) return false;
          const sw = shoulderWidth(landmarks);
          if (sw == null || sw < 1e-4) return false;
          const diff = (s - h) / sw;
          return diff > 0.4 && diff <= 0.7;
      }},
      { id: 'hips-high', bodyPart: 'torso', cue: 'Lower your hips', say: 'Your hips are piking up — bring them back in line with your shoulders.', severity: 'warn', test: ({ landmarks }) => {
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          if (s == null || h == null) return false;
          const sw = shoulderWidth(landmarks);
          return sw != null && sw > 1e-4 && (s - h) / sw > 0.7;
      }},
      { id: 'hips-sag', bodyPart: 'torso', cue: 'Don\'t let your hips sag', say: 'Your hips are dropping toward the floor — brace your core and lift them back to a straight line.', severity: 'warn', test: ({ landmarks }) => {
          const s = pairY(landmarks, L.LeftShoulder, L.RightShoulder);
          const h = pairY(landmarks, L.LeftHip, L.RightHip);
          if (s == null || h == null) return false;
          const sw = shoulderWidth(landmarks);
          return sw != null && sw > 1e-4 && (h - s) / sw > 0.55;
      }},
      { id: 'body-line', bodyPart: 'torso', cue: 'Keep a straight line', say: 'Keep one straight line from your shoulders to your heels.', severity: 'info', test: ({ angles }) => angles.bodyLine != null && angles.bodyLine < 165 },
      { id: 'hands-mild', bodyPart: 'arm', cue: 'Hands under your shoulders', say: 'Slide your hands back under your shoulders for a steadier base.', severity: 'info', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftWrist, L.RightWrist); return o != null && o > 0.4 && o <= 0.65; } },
      { id: 'hands-not-stacked', bodyPart: 'arm', cue: 'Hands under your shoulders', say: 'Your hands have drifted well away from under your shoulders — plant them back underneath.', severity: 'warn', test: ({ landmarks }) => { const o = stackOffset(landmarks, L.LeftWrist, L.RightWrist); return o != null && o > 0.65; } },
      { id: 'bent-arms', bodyPart: 'arm', cue: 'Keep your arms straight', say: 'Lock your supporting arms straight — don\'t let your elbows bend.', severity: 'warn', test: ({ angles }) => angles.elbow != null && angles.elbow < 160 },
      { id: 'shallow-drive', bodyPart: 'leg', cue: 'Drive your knee closer to your chest', say: 'Drive your knee further in toward your chest, not just a tap.', severity: 'info', test: ({ angles }) => angles.hip != null && angles.hip > 115 && angles.hip < 145 },
      { id: 'shrug', bodyPart: 'arm', cue: 'Relax your shoulders', say: 'Push your shoulders down away from your ears instead of shrugging.', severity: 'info', test: ({ landmarks }) => { const g = shrugGap(landmarks); return g != null && g < 0.15; } },
      { id: 'neutral-neck', bodyPart: 'torso', cue: 'Keep your neck neutral', say: 'Keep your neck in line with your spine — don\'t crane your head up.', severity: 'info', test: ({ landmarks }) => {
          const nose = landmarks[L.Nose]; const ls = landmarks[L.LeftShoulder];
          return nose != null && ls != null && nose.visibility >= 0.5 && ls.visibility >= 0.5
            ? Math.abs(nose.x - ls.x) > 0.06 : false;
      }},
    ],
  }),
];

// The list `getExercise`/`getNextProgression`/`getPrevProgression` actually
// read from — starts as the compiled-in EXERCISES, but `registry.ts` swaps it
// for a remote-enriched merge (overrides + additions from GitHub) once one's
// available. Everything that just wants one exercise by slug or the next/prev
// step in a family (every screen except the handful that need the whole
// catalog reactively) keeps calling these same three functions unchanged —
// they transparently start seeing remote content the moment it loads, with
// no per-call-site awareness needed. `registry.ts` imports EXERCISES/helpers
// FROM this file, so this file can't import back from registry.ts (would be
// circular) — `setActiveExercises` is how it pushes updates the other way.
let activeExercises: Exercise[] = EXERCISES;

/** Called by `registry.ts` whenever the remote-merged list changes (on
 * startup rehydration and after every successful `refresh()`). Not meant to
 * be called from anywhere else. */
export function setActiveExercises(list: Exercise[]): void {
  activeExercises = list;
}

export function getExercise(slug: string): Exercise | undefined {
  return activeExercises.find((e) => e.slug === slug);
}

/** Next step in the same progression family (lowest level above this one). */
export function getNextProgression(ex: Exercise): Exercise | undefined {
  return activeExercises.filter((e) => e.family === ex.family && e.level > ex.level).sort((a, b) => a.level - b.level)[0];
}

/** Previous (easier) step in the same family. */
export function getPrevProgression(ex: Exercise): Exercise | undefined {
  return activeExercises.filter((e) => e.family === ex.family && e.level < ex.level).sort((a, b) => b.level - a.level)[0];
}
