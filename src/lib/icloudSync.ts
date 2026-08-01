/**
 * iCloud backup for settings/profile/recent workout history, via Apple's
 * `NSUbiquitousKeyValueStore` (the `expo-icloud-storage` native module —
 * exact same underlying API ISOMTRIC/FUELS's hand-rolled `ICloudBridge.m`
 * uses). This is a native module: it does NOT work inside Expo Go, only in a
 * real dev-client/EAS build (see the entitlement note in app.json and the
 * project memory for the exact `expo prebuild` + EAS steps ISOMTRIC/FUELS
 * already went through). Every call into the module is wrapped in try/catch
 * so the app can never crash from this — while still running in Expo Go
 * (before that migration happens), every function here just silently no-ops.
 *
 * Scope, on purpose (see Settings copy too): settings + profile + the most
 * recent `MAX_SYNCED_SESSIONS` workout sessions as lightweight records
 * (`CloudSessionRecord` — no video, no per-frame replay/pose data). iCloud's
 * key-value store caps out at ~1MB total, nowhere near enough for video or
 * full unbounded history — this is a backup of your numbers and settings,
 * not your recorded clips. Reopening an old session's replay on a different
 * device than it was recorded on just shows no video, same as the existing
 * "no video available" fallback already handles today.
 *
 * `expo-icloud-storage`'s actual API (checked its shipped .d.ts, not
 * guessed): `set`/`getString`/`remove`/`getAllKeys`, all synchronous — no
 * "changed on another device" event. So instead of reacting to a push
 * notification (which doesn't exist here), this re-checks at a small,
 * deliberate set of moments — app launch, returning to the foreground, and
 * joining WiFi — never on a timer/continuously, and never more than once a
 * minute across all of them combined, so this can't be a source of jank.
 */
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { insertIfMissing, listSessionsForSync, type CloudSessionRecord } from '@/storage/db';
import { useProfile } from '@/store/profile';
import { useSettings } from '@/store/settings';

/** Transient, NOT persisted — just so Settings can show real status ("Synced
 * just now") instead of a static "coming soon." Resets to nulls on every
 * app launch, which is fine: it's a live indicator, not a record. */
export const useSyncStatus = create<{ lastSyncedAt: number | null; syncing: boolean }>()(() => ({
  lastSyncedAt: null,
  syncing: false,
}));

// `expo-icloud-storage` throws THE MOMENT it's imported (not when a function
// on it is called) if its native module isn't linked — which is always true
// in plain Expo Go, only working in a real dev-client/EAS build. A top-level
// `import` would let that throw escape before any try/catch here exists,
// crashing the whole module graph (and with it every route, since settings.tsx
// imports this file). Loading it lazily, inside a try/catch, keeps that same
// "silently unavailable in Expo Go" no-op behavior every function below
// already assumes, instead of a hard crash.
let cloudStorage: typeof import('expo-icloud-storage').default | null | undefined;
function getCloudStorage(): typeof import('expo-icloud-storage').default | null {
  if (cloudStorage === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be a synchronous, lazily-evaluated load (see comment above); a static or dynamic import can't provide either.
      cloudStorage = require('expo-icloud-storage').default;
    } catch {
      cloudStorage = null;
    }
  }
  return cloudStorage ?? null;
}

const CLOUD_KEY = 'formora_sync_v1';
const MAX_SYNCED_SESSIONS = 300;
/** Real cap is ~1MB — this leaves headroom for settings/profile/JSON overhead. */
const MAX_BLOB_BYTES = 900_000;
const PUSH_DEBOUNCE_MS = 8000;
const MIN_PULL_INTERVAL_MS = 60 * 1000;

type SyncedSettings = {
  hapticCues: boolean;
  repHaptics: boolean;
  repDing: boolean;
  voiceCoach: boolean;
  mirrorFrontCamera: boolean;
  countdownSec: number;
  cameraFacing: ReturnType<typeof useSettings.getState>['cameraFacing'];
  workoutAlertStyle: ReturnType<typeof useSettings.getState>['workoutAlertStyle'];
};
type SyncedProfile = {
  heightCm: number | null;
  weightKg: number | null;
  units: ReturnType<typeof useProfile.getState>['units'];
  sex: ReturnType<typeof useProfile.getState>['sex'];
  age: number | null;
};
type CloudBlob = {
  updatedAt: number;
  settings: SyncedSettings;
  profile: SyncedProfile;
  sessions: CloudSessionRecord[];
};

function snapshotSettings(): SyncedSettings {
  const s = useSettings.getState();
  return {
    hapticCues: s.hapticCues,
    repHaptics: s.repHaptics,
    repDing: s.repDing,
    voiceCoach: s.voiceCoach,
    mirrorFrontCamera: s.mirrorFrontCamera,
    countdownSec: s.countdownSec,
    cameraFacing: s.cameraFacing,
    workoutAlertStyle: s.workoutAlertStyle,
  };
}

function snapshotProfile(): SyncedProfile {
  const p = useProfile.getState();
  return { heightCm: p.heightCm, weightKg: p.weightKg, units: p.units, sex: p.sex, age: p.age };
}

function applySettings(s: Partial<SyncedSettings>) {
  const st = useSettings.getState();
  if (s.hapticCues != null) st.setHapticCues(s.hapticCues);
  if (s.repHaptics != null) st.setRepHaptics(s.repHaptics);
  if (s.repDing != null) st.setRepDing(s.repDing);
  if (s.voiceCoach != null) st.setVoiceCoach(s.voiceCoach);
  if (s.mirrorFrontCamera != null) st.setMirrorFrontCamera(s.mirrorFrontCamera);
  if (s.countdownSec != null) st.setCountdownSec(s.countdownSec);
  if (s.cameraFacing != null) st.setCameraFacing(s.cameraFacing);
  if (s.workoutAlertStyle != null) st.setWorkoutAlertStyle(s.workoutAlertStyle);
}

function applyProfile(p: Partial<SyncedProfile>) {
  const st = useProfile.getState();
  if (p.heightCm !== undefined) st.setHeightCm(p.heightCm);
  if (p.weightKg !== undefined) st.setWeightKg(p.weightKg);
  if (p.units != null) st.setUnits(p.units);
  if (p.sex != null) st.setSex(p.sex);
  if (p.age !== undefined) st.setAge(p.age);
}

// Tracks "when did MY OWN device last change settings/profile" so a pull can
// tell whether the cloud copy is actually newer before overwriting anything
// local — these are single objects, not lists, so last-write-wins is the
// right (and only practical) merge strategy for them. Session records don't
// need this: `insertIfMissing` already makes merging those a safe no-op for
// anything that already exists locally.
let lastLocalChangeAt = Date.now();
useSettings.subscribe(() => {
  lastLocalChangeAt = Date.now();
});
useProfile.subscribe(() => {
  lastLocalChangeAt = Date.now();
});

/**
 * Best-effort availability check. `expo-icloud-storage` doesn't expose a
 * dedicated "is iCloud available" call (checked — only set/getString/remove/
 * getAllKeys exist), so this does the safest available thing: try a real
 * call and treat any throw (module not linked because we're still in Expo
 * Go, iCloud not signed in, disabled for the app, etc.) as "not available."
 */
export function isICloudAvailable(): boolean {
  const cs = getCloudStorage();
  if (!cs) return false;
  try {
    cs.getAllKeys();
    return true;
  } catch {
    return false;
  }
}

async function buildSyncableSessions(): Promise<CloudSessionRecord[]> {
  let sessions: CloudSessionRecord[] = await listSessionsForSync(MAX_SYNCED_SESSIONS);
  // Defensive size trim so a huge history can never be the reason this feels
  // slow or silently fails — drop the oldest sessions first until it fits.
  while (sessions.length > 0 && JSON.stringify(sessions).length > MAX_BLOB_BYTES) {
    sessions = sessions.slice(0, Math.ceil(sessions.length * 0.8));
  }
  return sessions;
}

export async function pushToCloud(): Promise<void> {
  if (!useSettings.getState().iCloudSyncEnabled) return;
  const cs = getCloudStorage();
  if (!cs) return;
  useSyncStatus.setState({ syncing: true });
  try {
    const sessions = await buildSyncableSessions();
    const blob: CloudBlob = {
      updatedAt: Date.now(),
      settings: snapshotSettings(),
      profile: snapshotProfile(),
      sessions,
    };
    cs.set(CLOUD_KEY, JSON.stringify(blob));
    useSyncStatus.setState({ lastSyncedAt: Date.now() });
  } catch {
    // Best-effort — most likely cause is still running in Expo Go (native
    // module not linked yet) or iCloud unavailable. Never let a backup
    // attempt break a workout save.
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Call after a workout session is saved — debounced so finishing several
 * sets back-to-back coalesces into one write instead of one per set. */
export function schedulePushToCloud(): void {
  if (!useSettings.getState().iCloudSyncEnabled) return;
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushToCloud();
  }, PUSH_DEBOUNCE_MS);
}

export async function pullFromCloud(): Promise<void> {
  if (!useSettings.getState().iCloudSyncEnabled) return;
  const cs = getCloudStorage();
  if (!cs) return;
  useSyncStatus.setState({ syncing: true });
  try {
    const raw = cs.getString(CLOUD_KEY);
    if (!raw) return;
    const blob = JSON.parse(raw) as Partial<CloudBlob>;
    if (typeof blob.updatedAt !== 'number') return;

    if (Array.isArray(blob.sessions)) {
      for (const rec of blob.sessions) {
        try {
          await insertIfMissing(rec);
        } catch {
          // One malformed/conflicting record never blocks the rest.
        }
      }
    }

    // Only adopt cloud settings/profile if they're actually newer than what
    // this device already has — otherwise a device that hasn't synced in a
    // while would clobber fresher local changes with stale cloud data.
    if (blob.updatedAt > lastLocalChangeAt) {
      if (blob.settings) applySettings(blob.settings);
      if (blob.profile) applyProfile(blob.profile);
      // Adopt the cloud's timestamp, not "now" — applying these values just
      // triggered our own subscribe listeners above, which would otherwise
      // make this device look like it has fresher unsynced local changes
      // than it actually does, right after a pull.
      lastLocalChangeAt = blob.updatedAt;
    }
    useSyncStatus.setState({ lastSyncedAt: Date.now() });
  } catch {
    // Any failure — not available, malformed data — leaves local state untouched.
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

let lastPullAttemptAt = 0;
function pullIfDue() {
  if (Date.now() - lastPullAttemptAt < MIN_PULL_INTERVAL_MS) return;
  lastPullAttemptAt = Date.now();
  pullFromCloud();
}

// Re-check whenever the app comes back to the foreground — the natural
// "I switched devices, opened the app" moment.
AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'active') pullIfDue();
});

// Re-check on WiFi (not cellular — a background check shouldn't spend
// mobile data), same reasoning as the exercise registry's WiFi listener
// (src/exercises/registry.ts) — react to a real signal, not a timer.
Network.addNetworkStateListener((state) => {
  if (state.type !== Network.NetworkStateType.WIFI || !state.isConnected) return;
  pullIfDue();
});
