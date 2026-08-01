/**
 * Pose data model. We standardize on the MediaPipe / BlazePose 33-landmark
 * layout produced by the on-device camera tracker (src/camera/useCameraPose.ts).
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
  /** Which source produced it (for debugging / accuracy notes). 'mock' is the
   *  synthetic demo squat; 'mediapipe' is the on-device camera tracker. */
  source: 'mock' | 'mediapipe';
  /** Upright camera frame's width/height ratio (the same "portrait aspect"
   *  convention CameraStage.stopRecording() uses). Landmarks are normalized
   *  against this frame, NOT against whatever box they're displayed in — a
   *  live view must cover-crop by this ratio the same way the review screen
   *  already does, or the skeleton drifts off the body whenever the box's
   *  aspect ratio differs from the camera's. */
  frameAspect?: number;
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

/**
 * Landmarks that affect exercise angle/reps math. Face (1-10), hand-detail
 * (17-22) and foot-detail (29-32) landmarks don't participate in any angle
 * computation — smoothing them wastes CPU/Gas-collection budget for zero
 * functional gain at 15fps.
 */
export const SMOOTHED_LANDMARK_INDICES: readonly L[] = [
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
