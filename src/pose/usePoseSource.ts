import { useEffect, useRef } from 'react';

import { mockSquatFrame, squatPhase } from '@/pose/mockPose';
import type { PoseFrame } from '@/pose/types';

type Options = {
  active: boolean;
  fps?: number;
  onFrame: (frame: PoseFrame) => void;
};

/**
 * Emits synthetic PoseFrames (a demo squat) to `onFrame` while `active`, so the
 * full workout flow — rep counting, form rules, HUD, review — runs without a
 * real body tracker. Swap this out for a real detector's frame stream once
 * one is wired in.
 */
export function usePoseSource({ active, fps = 30, onFrame }: Options) {
  const start = useRef<number | null>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;

  useEffect(() => {
    if (!active) {
      start.current = null;
      return;
    }
    start.current = Date.now();
    const interval = setInterval(() => {
      const t = Date.now() - (start.current ?? Date.now());
      cb.current(mockSquatFrame(t, squatPhase(t)));
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [active, fps]);
}
