/**
 * On-device camera pose source: VisionCamera frame processor -> MediaPipe
 * Pose Landmarker (react-native-mediapipe-posedetection, GPU delegate,
 * LIVE_STREAM mode) -> the app's native 33-point BlazePose Landmark[] ->
 * handed to the caller on the JS thread via the same `onFrame` contract the
 * previous trackers used, so the engine/HUD/review pipeline is untouched.
 *
 * Why MediaPipe over the previous MoveNet/tflite stack:
 * - Emits the SAME 33-landmark BlazePose layout the app's data model was
 *   designed around (src/pose/types.ts) — no decode/up-map layer, and
 *   exercises get real ankle/heel/foot-index points MoveNet never had.
 * - LIVE_STREAM mode has built-in temporal smoothing + tracking, so the
 *   hand-rolled EMA/hold-window smoothing layer is gone entirely.
 * - The plugin's native side handles frame rotation itself (we pass the
 *   output orientation through VisionCamera's onOutputOrientationChanged),
 *   so all the manual rotate/resize/crop math — where most of the previous
 *   pipeline's bugs lived — is gone.
 *
 * Coordinate conversion (the one part we still own): MediaPipe returns
 * landmarks normalized against the RAW pre-rotation camera frame. The
 * package's own ViewCoordinator (passed to onResults) computes the rotation
 * needed to make them upright from the live frame/output orientations — we
 * read that and apply the same rotateNormalizedPoint math its bundled
 * examples render with, then normalize into the app's upright, unmirrored
 * landmark space (the convention the recorder, overlay and replay already
 * share).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  type CameraDevice,
  type Orientation,
} from 'react-native-vision-camera';
import {
  Delegate,
  RunningMode,
  usePoseDetection,
  type PoseDetectionResultBundle,
  type ViewCoordinator,
} from 'react-native-mediapipe-posedetection';

import { LandmarkSmoother } from '@/pose/oneEuroFilter';
import { LANDMARK_COUNT, SMOOTHED_LANDMARK_INDICES, type Landmark, type PoseFrame } from '@/pose/types';
import type { CameraFacing } from '@/store/settings';

/** Dropped again, from 720p to 540p (960x540) — device-reported: even after
 * the 1080p->720p cut and the fps/smoothing/jolt-threshold tuning, tracking
 * still visibly stalls specifically once real push-up reps start (fine
 * during unstructured fast arm movement beforehand), which reads as
 * inference genuinely not keeping up with the per-frame compute cost, not a
 * rejection-logic problem (those were separately fixed in stability.ts).
 * Push-ups are filmed from ~1.5m per the exercise's own setup instructions —
 * closer than most other moves — so the subject fills most of the frame
 * even at 540p; there are still plenty of pixels on the joints that matter,
 * unlike a move filmed from 3-4m where resolution loss would actually cost
 * tracking precision. Requested as a [min, max] FPS range (not a fixed
 * value) — some devices only support discrete fps steps per format, and
 * forcing an unsupported exact value is a real crash risk on
 * `stopRecording()`. */
const TARGET_RESOLUTION = { width: 960, height: 540 };
const TARGET_CAPTURE_FPS = 30;
const MIN_CAPTURE_FPS = 24;

/** Bundled at build time by the package's Expo config plugin (see app.json:
 * it copies assets/models/ into the native projects). Filename only — the
 * native side resolves it from the app bundle / android assets. */
const MODEL_FILE = 'pose_landmarker_lite.task';

/**
 * Pose inference + result rate (also the UI update rate — every result
 * triggers React state updates in ExerciseTracker). Reverted 24 -> 15.
 *
 * This was raised from 15 to 24 to fix "skeleton doesn't track fast push-up
 * motion" — but that turned out to actually be fixed by a completely
 * different change (the One-Euro filter's `beta` was scaled for pixel-space
 * coordinates instead of this app's 0-1 normalized space, making it
 * effectively inert — see SMOOTH_BETA below). The fps raise rode along
 * unproven and never got revisited once the real fix landed.
 *
 * Meanwhile it has a real, direct cost: this is the rate the native GPU
 * inference pipeline actually gets asked to run at, and 24 asks for 60% more
 * inference calls per second than 15 — on a device where that native
 * pipeline is already the bottleneck (confirmed: the athlete could
 * previously do fast unbroken sets before any of this tuning, and tracking
 * has gotten measurably worse, not better, since raising this), asking it to
 * do 60% more work per second is one of the most direct ways this app can
 * make that worse. Capture itself stays at 24-30fps (TARGET_CAPTURE_FPS
 * above) purely for recording smoothness — this is the SEPARATE throttle on
 * how often the pose model itself actually runs, decoupled from that.
 */
const TARGET_FPS = 15;

/**
 * One-euro filter tuning (see src/pose/oneEuroFilter.ts) for landmarks
 * normalized to 0..1 — NOT pixels. This matters: the filter's `beta` scales
 * the cutoff frequency by the point's raw velocity, and every published
 * tuning guide (mouse cursors, on-screen widgets) assumes PIXEL-scale
 * signals where a fast motion reads as hundreds of units/sec. A push-up's
 * shoulder in our 0..1 space moves at something like 0.5-1.0 units/sec —
 * a `beta` borrowed straight from those guides (~0.4-1.2) is effectively
 * inert at this scale, so the filter stayed in its heavy-smoothing regime
 * even during fast motion. That was the actual bug behind "the skeleton
 * doesn't go down" — beta needs to be an order of magnitude higher to have
 * any real effect in normalized-coordinate space. */
const SMOOTH_MIN_CUTOFF = 1.0;
const SMOOTH_BETA = 15;

/**
 * iOS front-camera frame buffers reach the frame processor mirrored
 * (established empirically with the previous pipeline: counter-mirroring
 * the front camera's inference input is what fixed the left/right-swapped
 * skeleton, then confirmed on device). MediaPipe sees that same mirrored
 * buffer, so its output needs un-mirroring for the front camera: flip x AND
 * swap left/right landmark labels — together exactly equivalent to having
 * un-mirrored the input image. If a device test ever shows the skeleton
 * left/right swapped again, flip this to false — one line.
 */
const FRONT_FRAMES_ARE_MIRRORED = true;

/** Pre-allocated landmark array reused every frame to avoid 33 object allocations
 *  per result (~495/sec at 15fps). Downstream consumers that need to KEEP a
 *  copy (timeline storage) must snapshot — SessionEngine already does this. */
const landmarkPool: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({
  x: 0, y: 0, z: 0, visibility: 0,
}));

/** BlazePose left<->right counterpart index (identity for center points).
 * Used to relabel anatomically when un-mirroring a mirrored frame's output. */
const MIRROR_INDEX: readonly number[] = [
  0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19,
  22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31,
];

/** Same math as the package's shared/convert.ts (not exported from its
 * root), applied with the rotation its ViewCoordinator computed. */
function rotateNormalizedPoint(x: number, y: number, rotation: number): { x: number; y: number } {
  if (rotation === 90) return { x: y, y: 1 - x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270 || rotation === -90) return { x: 1 - y, y: x };
  return { x, y };
}



export type CameraPoseStatus =
  | 'requesting-permission'
  | 'no-permission'
  | 'no-device'
  | 'loading-model'
  | 'model-error'
  | 'ready';

type Options = {
  active: boolean;
  facing: CameraFacing;
  onFrame: (frame: PoseFrame) => void;
};

export function useCameraPose({ active, facing, onFrame }: Options) {
  const device: CameraDevice | undefined = useCameraDevice(facing);
  const format = useCameraFormat(device, [
    { videoResolution: TARGET_RESOLUTION },
    { fps: TARGET_CAPTURE_FPS },
  ]);
  // A range, not a fixed number — VisionCamera is then free to pick any
  // supported fps within it, which is the documented safer option (some
  // formats only support discrete fps steps, and forcing an unsupported
  // exact value is a known cause of camera-session crashes).
  const captureFps: [number, number] | undefined = format
    ? [Math.max(format.minFps, Math.min(MIN_CAPTURE_FPS, format.maxFps)), Math.max(format.minFps, Math.min(TARGET_CAPTURE_FPS, format.maxFps))]
    : undefined;
  const { hasPermission, requestPermission } = useCameraPermission();

  const cbRef = useRef(onFrame);
  cbRef.current = onFrame;
  const activeRef = useRef(active);
  activeRef.current = active;
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const startRef = useRef<number | null>(null);
  const lastProcessedRef = useRef(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // One smoother instance for the hook's lifetime; reset (not recreated) on
  // facing flips / tracking restarts so old filter state never drags the
  // first new frames toward a stale position.
  const smootherRef = useRef<LandmarkSmoother | null>(null);
  if (!smootherRef.current) smootherRef.current = new LandmarkSmoother(SMOOTHED_LANDMARK_INDICES, SMOOTH_MIN_CUTOFF, SMOOTH_BETA);

  useEffect(() => {
    if (!active) startRef.current = null;
    smootherRef.current?.reset();
  }, [active, facing]);

  useEffect(() => {
    if (hasPermission || permissionDenied) return;
    requestPermission()
      .then((granted) => setPermissionDenied(!granted))
      .catch(() => setPermissionDenied(true));
  }, [hasPermission, permissionDenied, requestPermission]);

  const onResults = useCallback((bundle: PoseDetectionResultBundle, vc: ViewCoordinator) => {
    if (!activeRef.current) return;
    // Frame-skip guard: prevent JS-thread backlog if native inference
    // temporarily outruns React's ability to keep up. At TARGET_FPS=15 the
    // nominal per-frame gap is ~67ms, so 50ms guard skips at most one frame.
    const now = Date.now();
    if (now - lastProcessedRef.current < 50) return;
    lastProcessedRef.current = now;
    const pose = bundle.results[0]?.landmarks?.[0];
    if (!pose || pose.length < LANDMARK_COUNT) return;

    // The coordinator's precomputed rotation (raw frame -> upright output).
    // Private field, but it's the package's own live-computed ground truth —
    // fall back to inferring from the frame shape (portrait-locked app: a
    // landscape raw buffer always needs a quarter turn).
    const vcRotation = (vc as unknown as { rotation?: number }).rotation;
    const rotation =
      typeof vcRotation === 'number'
        ? vcRotation
        : bundle.inputImageWidth > bundle.inputImageHeight
          ? 90
          : 0;

    const unmirror = FRONT_FRAMES_ARE_MIRRORED && facingRef.current === 'front';

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const src = pose[unmirror ? MIRROR_INDEX[i] : i];
      const r = rotateNormalizedPoint(src.x, src.y, rotation);
      landmarkPool[i].x = unmirror ? 1 - r.x : r.x;
      landmarkPool[i].y = r.y;
      landmarkPool[i].z = src.z;
      landmarkPool[i].visibility = src.visibility ?? src.presence ?? 1;
    }

    if (startRef.current == null) startRef.current = Date.now();
    const t = Date.now() - startRef.current;
    // One-euro smoothing on the upright landmarks (see src/pose/oneEuroFilter.ts) —
    // kills MediaPipe's frame-to-frame jitter at rest without lagging behind
    // real rep motion.
    const landmarks = smootherRef.current!.smooth(landmarkPool, t / 1000);

    // The upright frame's aspect ratio (post-rotation, same "portrait
    // width/height" convention CameraStage.stopRecording() uses) — the
    // overlay needs this to cover-crop landmarks onto its box the same way
    // the review screen already does, instead of assuming the frame fills
    // the box 1:1 (it usually doesn't, which is why the live skeleton drifts
    // off the body).
    const rotated = rotation === 90 || rotation === 270 || rotation === -90;
    const uprightW = rotated ? bundle.inputImageHeight : bundle.inputImageWidth;
    const uprightH = rotated ? bundle.inputImageWidth : bundle.inputImageHeight;
    const frameAspect = uprightW > uprightH ? uprightH / uprightW : uprightW / uprightH;

    const frame: PoseFrame = {
      landmarks,
      t,
      source: 'mediapipe',
      frameAspect,
    };
    cbRef.current(frame);
  }, []);

  const onError = useCallback((error: { code: number; message: string }) => {
    console.warn(`[useCameraPose] MediaPipe detection error ${error.code}: ${error.message}`);
  }, []);

  const callbacks = useMemo(() => ({ onResults, onError }), [onResults, onError]);

  const solution = usePoseDetection(callbacks, RunningMode.LIVE_STREAM, MODEL_FILE, {
    numPoses: 1,
    delegate: Delegate.GPU,
    // We own mirroring (see FRONT_FRAMES_ARE_MIRRORED) — their mirror modes
    // only affect their own view-space converter, which we don't use.
    mirrorMode: 'no-mirror',
    fpsMode: TARGET_FPS,
    minTrackingConfidence: 0.5,
  });

  // Feeds the coordinator's sensor-orientation bookkeeping, same as the
  // package's own camera wrapper does.
  useEffect(() => {
    if (device) solution.cameraDeviceChangeHandler(device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  let status: CameraPoseStatus;
  if (permissionDenied) status = 'no-permission';
  else if (!hasPermission) status = 'requesting-permission';
  else if (!device) status = 'no-device';
  else status = 'ready';

  return {
    device,
    hasPermission,
    status,
    frameProcessor: solution.frameProcessor,
    /** Wire to <Camera onOutputOrientationChanged> so the native side always
     * knows which way is up. */
    onOrientationChanged: solution.cameraOrientationChangedHandler as (o: Orientation) => void,
    /** Explicit capture format/fps for <Camera> — see TARGET_RESOLUTION/
     * TARGET_CAPTURE_FPS above. Both preview+recording and pose inference
     * read from this same locked-down feed. */
    format,
    fps: captureFps,
  };
}
