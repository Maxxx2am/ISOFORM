/** Persisted user preferences (accent color, coaching options). */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';
import { DEFAULT_ACCENT, type AccentId } from '@/theme/palette';

export type CameraFacing = 'front' | 'back';
export type WorkoutAlertStyle = 'sound' | 'voice';

type SettingsState = {
  accent: AccentId;
  /** Speak/vibrate form cues during a set. */
  hapticCues: boolean;
  /** Count reps out loud via haptics on each completed rep. */
  repHaptics: boolean;
  /** Play a "ding" sound on each counted rep. */
  repDing: boolean;
  /** Spoken form coaching during a set (TTS). */
  voiceCoach: boolean;
  /** Mirror the front camera (natural for self-view). */
  mirrorFrontCamera: boolean;
  /** Seconds of "get ready" countdown before tracking starts. */
  countdownSec: number;
  /** Which camera to use. */
  cameraFacing: CameraFacing;
  /** How a workout goal is announced when you hit it: a beep, or spoken. */
  workoutAlertStyle: WorkoutAlertStyle;
  setAccent: (accent: AccentId) => void;
  setHapticCues: (on: boolean) => void;
  setRepHaptics: (on: boolean) => void;
  setRepDing: (on: boolean) => void;
  setVoiceCoach: (on: boolean) => void;
  setMirrorFrontCamera: (on: boolean) => void;
  setCountdownSec: (n: number) => void;
  setCameraFacing: (f: CameraFacing) => void;
  setWorkoutAlertStyle: (s: WorkoutAlertStyle) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      accent: DEFAULT_ACCENT,
      hapticCues: true,
      repHaptics: true,
      repDing: true,
      voiceCoach: true,
      mirrorFrontCamera: true,
      countdownSec: 3,
      cameraFacing: 'front',
      workoutAlertStyle: 'sound',
      setAccent: (accent) => set({ accent }),
      setHapticCues: (hapticCues) => set({ hapticCues }),
      setRepHaptics: (repHaptics) => set({ repHaptics }),
      setRepDing: (repDing) => set({ repDing }),
      setVoiceCoach: (voiceCoach) => set({ voiceCoach }),
      setMirrorFrontCamera: (mirrorFrontCamera) => set({ mirrorFrontCamera }),
      setCountdownSec: (countdownSec) => set({ countdownSec }),
      setCameraFacing: (cameraFacing) => set({ cameraFacing }),
      setWorkoutAlertStyle: (workoutAlertStyle) => set({ workoutAlertStyle }),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
