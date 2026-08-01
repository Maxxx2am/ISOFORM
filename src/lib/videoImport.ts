import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  Delegate,
  PoseDetectionOnImage,
  type PoseDetectionResultBundle,
} from 'react-native-mediapipe-posedetection';

import type { Exercise } from '@/exercises/types';
import { SessionEngine, type SessionSummary } from '@/engine/sessionEngine';
import { LandmarkSmoother } from '@/pose/oneEuroFilter';
import { LANDMARK_COUNT, SMOOTHED_LANDMARK_INDICES, type Landmark, type PoseFrame } from '@/pose/types';

const FRAME_INTERVAL_MS = 200;
const MAX_FRAMES = 300;
const MODEL_FILE = 'pose_landmarker_lite.task';

function toLandmarks(raw: PoseDetectionResultBundle['results'][0]): Landmark[] {
  if (!raw || !raw.landmarks || raw.landmarks.length === 0) return [];
  const pts = raw.landmarks[0];
  const out: Landmark[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = pts[i];
    if (p) {
      out[i] = { x: p.x, y: p.y, z: p.z, visibility: 1 };
    } else {
      out[i] = { x: 0, y: 0, z: 0, visibility: 0 };
    }
  }
  return out;
}

export type ImportProgress = {
  frame: number;
  total: number;
  phase: 'extracting' | 'tracking';
};

export type ImportResult = {
  summary: SessionSummary;
  timeline: { t: number; landmarks: Landmark[]; activeCue: string | null; reps: number }[];
};

export async function processImportedVideo(
  videoUri: string,
  exercise: Exercise,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const engine = new SessionEngine(exercise);
  const smoother = new LandmarkSmoother(SMOOTHED_LANDMARK_INDICES);

  for (let i = 0; i < MAX_FRAMES; i++) {
    const tMs = i * FRAME_INTERVAL_MS;
    const tSec = tMs / 1000;
    onProgress?.({ frame: i + 1, total: MAX_FRAMES, phase: 'extracting' });

    let thumb: { uri: string };
    try {
      thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: tMs, quality: 0.5 });
    } catch {
      break;
    }

    onProgress?.({ frame: i + 1, total: MAX_FRAMES, phase: 'tracking' });

    let detection: PoseDetectionResultBundle;
    try {
      detection = await PoseDetectionOnImage(thumb.uri, MODEL_FILE, {
        numPoses: 1,
        delegate: Delegate.GPU,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        shouldOutputSegmentationMasks: false,
      });
    } catch {
      continue;
    }

    const landmarks = toLandmarks(detection.results[0]);
    if (landmarks.length === 0) continue;

    smoother.smooth(landmarks, tSec);

    const frame: PoseFrame = {
      landmarks,
      t: tMs,
      source: 'mediapipe',
    };

    engine.push(frame, tMs);
  }

  const summary = engine.summarize((MAX_FRAMES - 1) * FRAME_INTERVAL_MS);
  const rawTimeline = engine.getTimeline();

  const timeline = rawTimeline.map((s) => ({
    t: s.t,
    landmarks: s.landmarks,
    activeCue: s.activeCue,
    reps: s.reps ?? 0,
  }));

  return { summary, timeline };
}
