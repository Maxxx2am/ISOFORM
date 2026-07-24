import { useEffect, useRef } from 'react';

import { mockSquatFrame, squatPhase } from '@/pose/mockPose';
import type { PoseFrame } from '@/pose/types';

export type PoseSourceMode = 'mock' | 'camera';

type Options = {
  active: boolean;
  /** 'mock' drives a synthetic squat (simulator/UI dev). 'camera' expects the
   *  VisionCamera frame processor to post frames instead (see camera/). */
  mode?: PoseSourceMode;
  fps?: number;
  onFrame: (frame: PoseFrame) => void;
};

/**
 * Emits PoseFrames to `onFrame` while `active`. In 'mock' mode it synthesizes a
 * squatting body on a timer so the full workout flow runs without a camera.
 * In 'camera' mode this hook is a no-op — the native frame processor is the
 * frame producer (see src/camera/useCameraPose.ts).
 */
export function usePoseSource({ active, mode = 'mock', fps = 30, onFrame }: Options) {
  const start = useRef<number | null>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;

  useEffect(() => {
    if (!active || mode !== 'mock') {
      start.current = null;
      return;
    }
    start.current = Date.now();
    const interval = setInterval(() => {
      const t = Date.now() - (start.current ?? Date.now());
      cb.current(mockSquatFrame(t, squatPhase(t)));
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [active, mode, fps]);
}
