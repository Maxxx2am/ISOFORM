/** Pure geometry helpers over pose landmarks. No React, no side effects. */
import type { Landmark } from '@/pose/types';
import { L } from '@/pose/types';

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
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle of segment A→B from horizontal, in degrees (-180..180). */
export function segmentAngle(a: Landmark, b: Landmark): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
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

/** Averages the left/right instance of a joint angle when both sides are visible. */
export function symmetricAngle(
  lms: Landmark[],
  left: readonly [L, L, L],
  right: readonly [L, L, L],
  threshold = 0.5,
): number | null {
  const lOk = allVisible(lms, left, threshold);
  const rOk = allVisible(lms, right, threshold);
  const lAng = lOk ? jointAngle(lms[left[0]], lms[left[1]], lms[left[2]]) : null;
  const rAng = rOk ? jointAngle(lms[right[0]], lms[right[1]], lms[right[2]]) : null;
  if (lAng != null && rAng != null) return (lAng + rAng) / 2;
  return lAng ?? rAng;
}
