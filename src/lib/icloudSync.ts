import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { insertIfMissing, listSessionsForSync, type CloudSessionRecord } from '@/storage/db';
import { useProfile } from '@/store/profile';
import { useSettings } from '@/store/settings';

type SyncStatus = { lastSyncedAt: number | null; syncing: boolean };
export const useSyncStatus = create<SyncStatus>(() => ({ lastSyncedAt: null, syncing: false }));

type CloudBlob = {
  updatedAt: number;
  syncEnabled: boolean;
  settings: Pick<ReturnType<typeof useSettings.getState>, 'hapticCues' | 'repHaptics' | 'repDing' | 'voiceCoach' | 'mirrorFrontCamera' | 'countdownSec' | 'cameraFacing' | 'workoutAlertStyle'>;
  profile: Pick<ReturnType<typeof useProfile.getState>, 'heightCm' | 'weightKg' | 'units' | 'sex' | 'age'>;
  sessions: CloudSessionRecord[];
};

const CLOUD_KEY = 'isoform_sync_v1';
const MAX_SESSIONS = 300;
const MAX_BYTES = 900_000;
const MIN_PULL_INTERVAL = 60_000;

let cloudStorage: typeof import('expo-icloud-storage').default | null | undefined;
function getCloudStorage(): typeof import('expo-icloud-storage').default | null {
  if (cloudStorage === undefined) {
    try {
      // The native module is unavailable in Expo Go, so load it only when used.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cloudStorage = require('expo-icloud-storage').default;
    } catch {
      cloudStorage = null;
    }
  }
  return cloudStorage ?? null;
}

export function isICloudAvailable(): boolean {
  const storage = getCloudStorage();
  if (!storage) return false;
  try {
    storage.getAllKeys();
    return true;
  } catch {
    return false;
  }
}

function snapshot(): Omit<CloudBlob, 'updatedAt' | 'sessions'> {
  const settings = useSettings.getState();
  const profile = useProfile.getState();
  return {
    syncEnabled: true,
    settings: {
      hapticCues: settings.hapticCues,
      repHaptics: settings.repHaptics,
      repDing: settings.repDing,
      voiceCoach: settings.voiceCoach,
      mirrorFrontCamera: settings.mirrorFrontCamera,
      countdownSec: settings.countdownSec,
      cameraFacing: settings.cameraFacing,
      workoutAlertStyle: settings.workoutAlertStyle,
    },
    profile: {
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      units: profile.units,
      sex: profile.sex,
      age: profile.age,
    },
  };
}

async function syncableSessions(): Promise<CloudSessionRecord[]> {
  let sessions = await listSessionsForSync(MAX_SESSIONS);
  while (sessions.length && JSON.stringify(sessions).length > MAX_BYTES) {
    sessions = sessions.slice(0, Math.ceil(sessions.length * 0.8));
  }
  return sessions;
}

export async function pushToCloud(): Promise<void> {
  if (!useSettings.getState().iCloudSyncEnabled) return;
  const storage = getCloudStorage();
  if (!storage) return;
  useSyncStatus.setState({ syncing: true });
  try {
    storage.set(CLOUD_KEY, JSON.stringify({ ...(snapshot()), updatedAt: Date.now(), sessions: await syncableSessions() } satisfies CloudBlob));
    useSyncStatus.setState({ lastSyncedAt: Date.now() });
  } catch {
    // iCloud availability can change while the app is running. Backup is best effort.
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePushToCloud(): void {
  if (!useSettings.getState().iCloudSyncEnabled) return;
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushToCloud();
  }, 8000);
}

export async function pullFromCloud(): Promise<void> {
  const storage = getCloudStorage();
  if (!storage) return;
  useSyncStatus.setState({ syncing: true });
  try {
    const raw = storage.getString(CLOUD_KEY);
    if (!raw) return;
    const blob = JSON.parse(raw) as Partial<CloudBlob>;
    if (blob.settings) {
      const local = useSettings.getState();
      if (blob.syncEnabled) local.setICloudSyncEnabled(true);
      if (blob.settings.hapticCues != null) local.setHapticCues(blob.settings.hapticCues);
      if (blob.settings.repHaptics != null) local.setRepHaptics(blob.settings.repHaptics);
      if (blob.settings.repDing != null) local.setRepDing(blob.settings.repDing);
      if (blob.settings.voiceCoach != null) local.setVoiceCoach(blob.settings.voiceCoach);
      if (blob.settings.mirrorFrontCamera != null) local.setMirrorFrontCamera(blob.settings.mirrorFrontCamera);
      if (blob.settings.countdownSec != null) local.setCountdownSec(blob.settings.countdownSec);
      if (blob.settings.cameraFacing != null) local.setCameraFacing(blob.settings.cameraFacing);
      if (blob.settings.workoutAlertStyle != null) local.setWorkoutAlertStyle(blob.settings.workoutAlertStyle);
    }
    if (blob.profile) {
      const local = useProfile.getState();
      if (blob.profile.heightCm !== undefined) local.setHeightCm(blob.profile.heightCm);
      if (blob.profile.weightKg !== undefined) local.setWeightKg(blob.profile.weightKg);
      if (blob.profile.units != null) local.setUnits(blob.profile.units);
      if (blob.profile.sex != null) local.setSex(blob.profile.sex);
      if (blob.profile.age !== undefined) local.setAge(blob.profile.age);
    }
    if (Array.isArray(blob.sessions)) {
      for (const session of blob.sessions) {
        try { await insertIfMissing(session); } catch { /* keep restoring other sessions */ }
      }
    }
    useSyncStatus.setState({ lastSyncedAt: Date.now() });
  } catch {
    // Ignore unavailable or malformed cloud data without affecting local data.
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

let lastPull = 0;
function pullIfDue() {
  if (Date.now() - lastPull < MIN_PULL_INTERVAL) return;
  lastPull = Date.now();
  void pullFromCloud();
}

AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'active') pullIfDue();
});
Network.addNetworkStateListener((state) => {
  if (state.type === Network.NetworkStateType.WIFI && state.isConnected) pullIfDue();
});
