/** Persisted user preferences (coaching options, camera, etc). Brand colors
 * are fixed (see theme/palette.ts) — not a user preference. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';
import { DEFAULT_ACCENT, type AccentId } from '@/theme/palette';

export type CameraFacing = 'front' | 'back';
export type WorkoutAlertStyle = 'sound' | 'voice';

type SettingsState = {
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
  /** Back up settings/profile/recent history to this Apple ID's iCloud —
   * see src/lib/icloudSync.ts. Off by default: it's a native module that
   * doesn't work until the app has left Expo Go for a real dev-client build. */
  iCloudSyncEnabled: boolean;
  /** Beta feedback: send this session's rep-counting data (angles/score/cues,
   * no images) to the developer for debugging — see src/lib/telemetry.ts.
   * Off by default, explicit opt-in only. */
  telemetryOptIn: boolean;
  /** Only meaningful when telemetryOptIn is also on — additionally uploads the
   * recorded clip itself, not just the numeric data. Off by default even then:
   * a separate, more sensitive opt-in. */
  telemetryIncludeVideo: boolean;
  /** Per-exercise slugs where "don't show setup tip again" was checked. */
  dismissedSetupTips: Record<string, boolean>;
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
  setHapticCues: (on: boolean) => void;
  setRepHaptics: (on: boolean) => void;
  setRepDing: (on: boolean) => void;
  setVoiceCoach: (on: boolean) => void;
  setMirrorFrontCamera: (on: boolean) => void;
  setCountdownSec: (n: number) => void;
  setCameraFacing: (f: CameraFacing) => void;
  setWorkoutAlertStyle: (s: WorkoutAlertStyle) => void;
  setICloudSyncEnabled: (on: boolean) => void;
  setTelemetryOptIn: (on: boolean) => void;
  setTelemetryIncludeVideo: (on: boolean) => void;
  dismissSetupTip: (slug: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      hapticCues: true,
      repHaptics: true,
      repDing: true,
      // Off by default — genuinely useful for holds (handstand etc., where
      // you can't watch the screen anyway), but for reps it's an add-on on
      // top of the visual gauge, not the primary feedback signal. Opt-in
      // keeps it available without it being the first thing everyone hears.
      voiceCoach: false,
      mirrorFrontCamera: true,
      countdownSec: 3,
      cameraFacing: 'front',
      workoutAlertStyle: 'sound',
      iCloudSyncEnabled: false,
      telemetryOptIn: false,
      telemetryIncludeVideo: false,
      dismissedSetupTips: {},
      accent: DEFAULT_ACCENT,
      setAccent: (accent) => set({ accent }),
      setHapticCues: (hapticCues) => set({ hapticCues }),
      setRepHaptics: (repHaptics) => set({ repHaptics }),
      setRepDing: (repDing) => set({ repDing }),
      setVoiceCoach: (voiceCoach) => set({ voiceCoach }),
      setMirrorFrontCamera: (mirrorFrontCamera) => set({ mirrorFrontCamera }),
      setCountdownSec: (countdownSec) => set({ countdownSec }),
      setCameraFacing: (cameraFacing) => set({ cameraFacing }),
      setWorkoutAlertStyle: (workoutAlertStyle) => set({ workoutAlertStyle }),
      setICloudSyncEnabled: (iCloudSyncEnabled) => set({ iCloudSyncEnabled }),
      setTelemetryOptIn: (telemetryOptIn) => set(telemetryOptIn ? { telemetryOptIn } : { telemetryOptIn, telemetryIncludeVideo: false }),
      setTelemetryIncludeVideo: (telemetryIncludeVideo) => set({ telemetryIncludeVideo }),
      dismissSetupTip: (slug) => set((s) => ({ dismissedSetupTips: { ...s.dismissedSetupTips, [slug]: true } })),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
