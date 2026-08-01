/**
 * Synthetic pose source for development on a simulator / before the native
 * model is wired. Produces a believable squatting skeleton so the timer, rep
 * engine, overlay, replay and history can all be built and demoed without a
 * camera. Swap for the real detector via usePoseSource.
 */
import type { Landmark, PoseFrame } from '@/pose/types';
import { L, LANDMARK_COUNT } from '@/pose/types';

function lm(x: number, y: number, visibility = 0.95, z = 0): Landmark {
  return { x, y, z, visibility };
}

/** Build a full 33-landmark frame for a squat at phase `s` (0 = stand, 1 = deep). */
export function mockSquatFrame(t: number, s: number): PoseFrame {
  const cx = 0.5;
  // Vertical bob: everything sinks a little as we descend.
  const hipY = 0.5 + 0.14 * s;
  const kneeY = 0.72 + 0.03 * s;
  const shoulderY = 0.3 + 0.16 * s;
  // Knees travel forward (wider) at the bottom.
  const kneeSpread = 0.09 + 0.03 * s;
  const noseY = shoulderY - 0.09;

  const landmarks: Landmark[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) landmarks[i] = lm(cx, noseY, 0.2);

  landmarks[L.Nose] = lm(cx, noseY);
  landmarks[L.LeftShoulder] = lm(cx - 0.1, shoulderY);
  landmarks[L.RightShoulder] = lm(cx + 0.1, shoulderY);
  landmarks[L.LeftElbow] = lm(cx - 0.13, shoulderY + 0.1);
  landmarks[L.RightElbow] = lm(cx + 0.13, shoulderY + 0.1);
  landmarks[L.LeftWrist] = lm(cx - 0.12, shoulderY + 0.2);
  landmarks[L.RightWrist] = lm(cx + 0.12, shoulderY + 0.2);
  landmarks[L.LeftHip] = lm(cx - 0.08, hipY);
  landmarks[L.RightHip] = lm(cx + 0.08, hipY);
  landmarks[L.LeftKnee] = lm(cx - kneeSpread, kneeY);
  landmarks[L.RightKnee] = lm(cx + kneeSpread, kneeY);
  landmarks[L.LeftAnkle] = lm(cx - 0.09, 0.92);
  landmarks[L.RightAnkle] = lm(cx + 0.09, 0.92);
  landmarks[L.LeftFootIndex] = lm(cx - 0.12, 0.96);
  landmarks[L.RightFootIndex] = lm(cx + 0.12, 0.96);

  return { landmarks, t, source: 'mock' };
}

/** Phase in 0..1 following a smooth squat cadence of `periodMs` per rep. */
export function squatPhase(t: number, periodMs = 3000): number {
  const p = (t % periodMs) / periodMs; // 0..1
  // cosine ease: 0 at top, 1 at bottom, back to 0.
  return (1 - Math.cos(p * 2 * Math.PI)) / 2;
}
