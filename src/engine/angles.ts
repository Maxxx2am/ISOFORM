/** Pure geometry helpers over pose landmarks. No React, no side effects. */
import type { Landmark } from '@/pose/types';
import { L } from '@/pose/types';

const RAD_TO_DEG = 180 / Math.PI;

/** Interior angle ABC at vertex B, in degrees (0..180). */
export function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (magAb * magCb)));
  return Math.acos(cos) * RAD_TO_DEG;
}

/** Angle of segment A→B from horizontal, in degrees (-180..180). */
export function segmentAngle(a: Landmark, b: Landmark): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * RAD_TO_DEG;
}

/** True when every listed landmark clears the visibility threshold. */
export function allVisible(
  lms: Landmark[],
  ids: readonly L[],
  threshold = 0.5,
): boolean {
  return ids.every((id) => (lms[id]?.visibility ?? 0) >= threshold);
}

/** Left↔right landmark counterparts, for side-view visibility checks. */
const MIRROR: Partial<Record<L, L>> = {
  [L.LeftShoulder]: L.RightShoulder,
  [L.RightShoulder]: L.LeftShoulder,
  [L.LeftElbow]: L.RightElbow,
  [L.RightElbow]: L.LeftElbow,
  [L.LeftWrist]: L.RightWrist,
  [L.RightWrist]: L.LeftWrist,
  [L.LeftHip]: L.RightHip,
  [L.RightHip]: L.LeftHip,
  [L.LeftKnee]: L.RightKnee,
  [L.RightKnee]: L.LeftKnee,
  [L.LeftAnkle]: L.RightAnkle,
  [L.RightAnkle]: L.LeftAnkle,
};

/**
 * View-aware body gate. Front view: every listed joint must be visible (both
 * arms/legs face the camera). Side view: filming your profile hides the far
 * side of the body, so each left/right PAIR only needs ONE visible side.
 */
export function bodyInView(
  lms: Landmark[],
  ids: readonly L[],
  view: 'front' | 'side',
  threshold = 0.4,
): boolean {
  if (view === 'front') return allVisible(lms, ids, threshold);
  const vis = (id: L) => (lms[id]?.visibility ?? 0) >= threshold;
  const done = new Set<L>();
  for (const id of ids) {
    if (done.has(id)) continue;
    const twin = MIRROR[id];
    if (twin != null && ids.includes(twin)) {
      done.add(id);
      done.add(twin);
      if (!vis(id) && !vis(twin)) return false;
    } else if (!vis(id)) {
      return false;
    }
  }
  return true;
}

/**
 * Rough front-vs-side body orientation. Two independent signals, checked in
 * order:
 *
 * 1. Visibility asymmetry — a true profile view OCCLUDES the far shoulder
 *    against the torso, so MediaPipe reports it with noticeably lower
 *    confidence than the near one. This is often the CLEAREST side-view
 *    signature there is, and a naive "both shoulders must be confidently
 *    visible before judging anything" check (the previous version of this
 *    function) systematically missed it — bailing to 'unknown' in exactly
 *    the case it most needed to catch, e.g. filming a push-up from the side
 *    slipping past a front-only exercise's orientation check entirely.
 * 2. Shoulder spread vs. torso height — when both shoulders ARE confidently
 *    visible (a real front view, or a side view shallow enough that
 *    occlusion isn't severe), facing the camera spreads them clearly apart;
 *    turned to a profile, the near/far shoulder nearly line up. Scale-
 *    invariant: compares against torso height (shoulder-to-hip), which
 *    barely changes with orientation, instead of an absolute distance that
 *    would only mean the right thing at one specific camera distance.
 *
 * Returns 'unknown' — never a forced guess — when neither signal is
 * confident, so a genuine in-between turn or missing landmarks never
 * misreads as a confirmed wrong-orientation.
 */
export function facingDirection(lms: Landmark[], threshold = 0.5): 'front' | 'side' | 'unknown' {
  const ls = lms[L.LeftShoulder];
  const rs = lms[L.RightShoulder];
  if (!ls || !rs) return 'unknown';

  // Signal 1: one shoulder confidently visible, the other clearly occluded.
  const occludedThreshold = 0.3;
  if (ls.visibility >= threshold && rs.visibility < occludedThreshold) return 'side';
  if (rs.visibility >= threshold && ls.visibility < occludedThreshold) return 'side';

  if (ls.visibility < threshold || rs.visibility < threshold) return 'unknown';

  // Signal 2: both confidently visible — fall back to the spread ratio.
  const shoulderSpread = Math.hypot(ls.x - rs.x, ls.y - rs.y);

  const lh = lms[L.LeftHip];
  const rh = lms[L.RightHip];
  const torsoSamples: number[] = [];
  if (lh && lh.visibility >= threshold) torsoSamples.push(Math.hypot(ls.x - lh.x, ls.y - lh.y));
  if (rh && rh.visibility >= threshold) torsoSamples.push(Math.hypot(rs.x - rh.x, rs.y - rh.y));
  if (torsoSamples.length === 0) return 'unknown';
  const torsoHeight = torsoSamples.reduce((a, b) => a + b, 0) / torsoSamples.length;
  if (torsoHeight < 0.02) return 'unknown';

  const ratio = shoulderSpread / torsoHeight;
  if (ratio > 0.55) return 'front';
  if (ratio < 0.28) return 'side';
  return 'unknown';
}

/** Averages the left/right instance of a joint angle when both sides are visible.
 *  Threshold matches bodyInView's 0.4 so a joint that's "visible enough to
 *  start tracking" is never "not visible enough to compute its actual angle." */
export function symmetricAngle(
  lms: Landmark[],
  left: readonly [L, L, L],
  right: readonly [L, L, L],
  threshold = 0.4,
): number | null {
  const lOk = allVisible(lms, left, threshold);
  const rOk = allVisible(lms, right, threshold);
  const lAng = lOk ? jointAngle(lms[left[0]], lms[left[1]], lms[left[2]]) : null;
  const rAng = rOk ? jointAngle(lms[right[0]], lms[right[1]], lms[right[2]]) : null;
  if (lAng != null && rAng != null) return (lAng + rAng) / 2;
  return lAng ?? rAng;
}
