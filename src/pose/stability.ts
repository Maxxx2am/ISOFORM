/**
 * Pose-quality gate. MediaPipe occasionally glitches — a joint teleports across
 * the frame, the skeleton flips left/right, or it jitters for a frame or two.
 * Real human motion moves smoothly frame-to-frame; a glitch is a large jump that
 * snaps back. We reject frames whose key joints jump implausibly far so they
 * never produce phantom reps.
 */
import { KEY_JOINTS, type L, type Landmark } from '@/pose/types';

/**
 * Max normalized distance any watched joint moved between two frames. Pass the
 * exercise's own joints — a push-up shouldn't lose its rep streak because the
 * FEET (hidden behind the body) glitched across the screen.
 */
export function maxJolt(
  prev: Landmark[],
  curr: Landmark[],
  joints: readonly L[] = KEY_JOINTS,
  minVis = 0.4,
): number {
  const watch = joints.length > 0 ? joints : KEY_JOINTS;
  let max = 0;
  for (const j of watch) {
    const a = prev[j];
    const b = curr[j];
    if (!a || !b) continue;
    if (a.visibility < minVis || b.visibility < minVis) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > max) max = d;
  }
  return max;
}

/** A jump larger than ~22% of the frame in one tick is not a real movement. */
export const JOLT_THRESHOLD = 0.22;

/** After this many consecutive rejected frames, accept anyway (genuine big move). */
export const MAX_SKIPPED = 12;
