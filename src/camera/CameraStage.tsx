import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera } from 'react-native-vision-camera';

import { useCameraPose, type CameraPoseStatus } from '@/camera/useCameraPose';
import type { PoseFrame } from '@/pose/types';
import type { CameraFacing } from '@/store/settings';

export type CameraStageHandle = {
  /** Starts a local (no-audio) recording of the raw camera feed for the
   * post-set replay. Safe to call before the finished callback of a
   * previous recording has fired. */
  startRecording: () => void;
  /** Resolves once the file is flushed to disk, or `null` if recording
   * never started / failed. */
  stopRecording: () => Promise<{ uri: string; aspect: number } | null>;
};

type Props = {
  active: boolean;
  /** Toggles the Camera's actual capture session. When false the native
   *  camera feed stops — frame processor, GPU inference, and all background
   *  threads drain before the capture session is torn down. Used by the
   *  finish flow to cleanly shut down MediaPipe before navigation unmounts
   *  the component tree (unmounting without this step was the root cause of
   *  the SIGSEGV crash on "Finish"). */
  cameraIsActive?: boolean;
  facing: CameraFacing;
  onFrame: (frame: PoseFrame) => void;
  onStatusChange?: (status: CameraPoseStatus) => void;
  /** Flip the preview horizontally so it visually matches SkeletonOverlay's
   * own `mirror` prop — landmarks are emitted in unmirrored space either
   * way (see useCameraPose), so only the two displays must agree. */
  mirror?: boolean;
};

/**
 * Renders the live camera preview and drives pose inference. Deliberately
 * renders nothing (not even a black View) until the device + model are
 * actually ready — the caller owns what "not ready yet" looks like via
 * `onStatusChange`, so there's never a silent black rectangle standing in
 * for a real loading/error state.
 */
export const CameraStage = forwardRef<CameraStageHandle, Props>(function CameraStage(
  { active, cameraIsActive, facing, onFrame, onStatusChange, mirror = false },
  ref,
) {
  const { device, status, frameProcessor, onOrientationChanged, format, fps } = useCameraPose({
    active,
    facing,
    onFrame,
  });
  const cameraRef = useRef<Camera>(null);
  const stopResolverRef = useRef<((v: { uri: string; aspect: number } | null) => void) | null>(null);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useImperativeHandle(
    ref,
    () => ({
      startRecording: () => {
        if (!cameraRef.current) return;
        cameraRef.current.startRecording({
          onRecordingFinished: (video) => {
            const resolve = stopResolverRef.current;
            stopResolverRef.current = null;
            // VisionCamera reports the encoder's raw pre-rotation track size
            // (RecordingSession.swift sets a rotation *transform* in the
            // video's metadata so players display it upright, but width/
            // height themselves are never swapped to match) — same
            // pre-rotation-dimensions gotcha as frame.width/height. This app
            // is portrait-locked, so a landscape-shaped report (width >
            // height) always means the actually-displayed video is portrait
            // and these need swapping to get the real aspect ratio.
            const aspect = video.width > video.height ? video.height / video.width : video.width / video.height;
            resolve?.({ uri: `file://${video.path}`, aspect });
          },
          onRecordingError: (error) => {
            console.warn('[CameraStage] recording failed:', error);
            const resolve = stopResolverRef.current;
            stopResolverRef.current = null;
            resolve?.(null);
          },
        });
      },
      stopRecording: () =>
        new Promise((resolve) => {
          if (!cameraRef.current) {
            resolve(null);
            return;
          }
          stopResolverRef.current = resolve;
          cameraRef.current.stopRecording().catch(() => {
            stopResolverRef.current = null;
            resolve(null);
          });
        }),
    }),
    [],
  );

  if (!device || status !== 'ready') return null;

  return (
    <Camera
      ref={cameraRef}
      style={[StyleSheet.absoluteFill, mirror && styles.mirrored]}
      device={device}
      // Locked to a known 720p/24-30fps format (see useCameraPose.ts)
      // instead of leaving VisionCamera's default format-selection heuristic
      // to pick whatever it thinks is "best" — that's what made both the
      // live skeleton and the recorded set-review clip choppy/low quality.
      // 720p (not 1080p) is a deliberate trade: still a good recording, but
      // meaningfully cheaper per-frame for the pose pipeline than 1080p was.
      // Deliberately NOT setting videoBitRate here — forcing a bitrate the
      // device's hardware encoder doesn't actually support for this
      // format is a real crash-on-stopRecording risk, and the format/fps
      // lock alone already fixes the choppiness.
      format={format}
      fps={fps}
      // When cameraIsActive is explicitly false, stop the capture session so
      // MediaPipe's GPU inference + background threads drain before the
      // component unmounts (see crash fix in ExerciseTracker.finishSet).
      // Defaults to true so the camera is always on by default — only the
      // explicit finish flow sets this to false, always AFTER stopRecording()
      // has already resolved (never during an in-flight recording).
      isActive={cameraIsActive ?? true}
      video
      audio={false}
      // The MediaPipe frame-processor plugin expects RGB frames (same as the
      // package's own camera wrapper configures).
      pixelFormat="rgb"
      frameProcessor={frameProcessor}
      onOutputOrientationChanged={onOrientationChanged}
    />
  );
});

const styles = StyleSheet.create({
  mirrored: { transform: [{ scaleX: -1 }] },
});
