/**
 * Pose data model. We standardize on the MediaPipe / BlazePose 33-landmark
 * layout. The MoveNet fallback (17 keypoints) is up-mapped into this same enum
 * so the rest of the app only ever sees one landmark vocabulary.
 */

/** Normalized landmark. x/y are 0..1 in image space; z is relative depth. */
export type Landmark = {
  x: number;
  y: number;
  z: number;
  /** 0..1 model confidence that the point is present & correctly placed. */
  visibility: number;
};

/** One inferred pose for a single camera frame. */
export type PoseFrame = {
  landmarks: Landmark[];
  /** ms timestamp relative to session start. */
  t: number;
  /** Which model produced it (for debugging / accuracy notes). */
  source: 'mediapipe' | 'movenet';
};

/** BlazePose 33-landmark indices. */
export enum L {
  Nose = 0,
  LeftEyeInner = 1,
  LeftEye = 2,
  LeftEyeOuter = 3,
  RightEyeInner = 4,
  RightEye = 5,
  RightEyeOuter = 6,
  LeftEar = 7,
  RightEar = 8,
  MouthLeft = 9,
  MouthRight = 10,
  LeftShoulder = 11,
  RightShoulder = 12,
  LeftElbow = 13,
  RightElbow = 14,
  LeftWrist = 15,
  RightWrist = 16,
  LeftPinky = 17,
  RightPinky = 18,
  LeftIndex = 19,
  RightIndex = 20,
  LeftThumb = 21,
  RightThumb = 22,
  LeftHip = 23,
  RightHip = 24,
  LeftKnee = 25,
  RightKnee = 26,
  LeftAnkle = 27,
  RightAnkle = 28,
  LeftHeel = 29,
  RightHeel = 30,
  LeftFootIndex = 31,
  RightFootIndex = 32,
}

export const LANDMARK_COUNT = 33;

/** Bone pairs used to draw the skeleton overlay. */
export const POSE_CONNECTIONS: readonly (readonly [L, L])[] = [
  // torso
  [L.LeftShoulder, L.RightShoulder],
  [L.LeftShoulder, L.LeftHip],
  [L.RightShoulder, L.RightHip],
  [L.LeftHip, L.RightHip],
  // left arm
  [L.LeftShoulder, L.LeftElbow],
  [L.LeftElbow, L.LeftWrist],
  // right arm
  [L.RightShoulder, L.RightElbow],
  [L.RightElbow, L.RightWrist],
  // left leg
  [L.LeftHip, L.LeftKnee],
  [L.LeftKnee, L.LeftAnkle],
  [L.LeftAnkle, L.LeftFootIndex],
  // right leg
  [L.RightHip, L.RightKnee],
  [L.RightKnee, L.RightAnkle],
  [L.RightAnkle, L.RightFootIndex],
];

/** Landmarks we draw as joint dots (skip the dense face cluster). */
export const KEY_JOINTS: readonly L[] = [
  L.Nose,
  L.LeftShoulder,
  L.RightShoulder,
  L.LeftElbow,
  L.RightElbow,
  L.LeftWrist,
  L.RightWrist,
  L.LeftHip,
  L.RightHip,
  L.LeftKnee,
  L.RightKnee,
  L.LeftAnkle,
  L.RightAnkle,
];
