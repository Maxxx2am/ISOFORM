/** Developer-only helpers for exercising the Insights/Review UI without doing real workouts. */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { SessionSummary } from '@/engine/sessionEngine';
import { getActiveExercises } from '@/exercises/registry';
import { makeId } from '@/lib/format';
import { useProfile } from '@/store/profile';
import { useSettings } from '@/store/settings';
import { clearAllSessions, insertIfMissing, listSessions, listSessionsFull, saveSession, type SessionRecord } from '@/storage/db';

/** Inserts a couple weeks of plausible fake sessions across a handful of tracked exercises. */
export async function seedDemoSessions(now: number = Date.now()): Promise<number> {
  const picks = getActiveExercises().filter((e) => e.tracked).slice(0, 6);
  let count = 0;
  for (let day = 13; day >= 0; day--) {
    for (const ex of picks) {
      // Skip most exercise/day combos so it looks like real, uneven training.
      if (Math.random() > 0.4) continue;
      const createdAt = now - day * 86_400_000 - Math.floor(Math.random() * 8) * 3_600_000;
      const isHold = ex.mode === 'hold';
      const reps = isHold ? 0 : 6 + Math.floor(Math.random() * 12);
      const holdSeconds = isHold ? 8 + Math.floor(Math.random() * 25) : 0;
      const summary: SessionSummary = {
        exerciseId: ex.id,
        mode: ex.mode,
        durationMs: 25_000 + Math.floor(Math.random() * 60_000),
        reps,
        holdSeconds,
        totalReps: reps,
        totalHoldSeconds: holdSeconds,
        activeMs: isHold ? holdSeconds * 1000 : 4000,
        attempts: 1 + Math.floor(Math.random() * 2),
        avgBottomAngle: ex.targetAngle ?? null,
        targetAngle: ex.targetAngle ?? null,
        depthScore: !isHold ? 55 + Math.floor(Math.random() * 40) : null,
        consistencyScore: !isHold ? 55 + Math.floor(Math.random() * 40) : null,
        avgRepSeconds: !isHold ? 1.2 + Math.random() * 1.5 : null,
        romDegrees: 60,
        formQuality: isHold ? 55 + Math.floor(Math.random() * 40) : null,
        cues: [],
        firstActionMs: 0,
        lastActionMs: isHold ? holdSeconds * 1000 : 4000,
        segments: [{ startMs: 0, endMs: isHold ? holdSeconds * 1000 : 4000, reps: isHold ? 0 : reps }],
        repThresholds: null,
      };
      await saveSession(makeId(createdAt), ex.name, createdAt, summary, null);
      count += 1;
    }
  }
  return count;
}

/** Deletes every workout session on the device — irreversible. */
export async function deleteAllData(): Promise<void> {
  await clearAllSessions();
}

/** All sessions as a plain-JSON string, for sharing/export. */
export async function exportDataAsJson(): Promise<string> {
  const rows: SessionRecord[] = await listSessionsFull();
  return JSON.stringify({ exportedAt: new Date().toISOString(), sessions: rows }, null, 2);
}

/** Import sessions from an export JSON string. Skips duplicates by ID.
 *  Returns { imported: number, skipped: number }. */
export async function importDataFromJson(json: string): Promise<{ imported: number; skipped: number }> {
  let parsed: { sessions?: SessionRecord[] };
  try {
    parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('Invalid format');
  } catch {
    throw new Error('Not a valid ISOFORM export file.');
  }
  let imported = 0;
  let skipped = 0;
  for (const rec of parsed.sessions) {
    if (!rec || typeof rec.id !== 'string' || typeof rec.createdAt !== 'number') continue;
    const added = await insertIfMissing(rec);
    if (added) imported++; else skipped++;
  }
  return { imported, skipped };
}

/** A plain-text support/QA summary — no PII beyond device model, meant to be
 * shared/pasted alongside a bug report rather than read on-screen. */
export async function buildDebugInfo(): Promise<string> {
  const sessions = await listSessions(100000).catch(() => []);
  const totalReps = sessions.reduce((sum, s) => sum + s.reps, 0);
  const totalHoldSeconds = sessions.reduce((sum, s) => sum + s.holdSeconds, 0);
  const lines = [
    `ISOFORM v${Constants.expoConfig?.version ?? '—'}`,
    `Build: ${Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '—'}`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `Device: ${Device.modelName ?? 'Unknown'}`,
    `OS: ${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim(),
    `Sessions logged: ${sessions.length}`,
    `Lifetime reps: ${totalReps}`,
    `Lifetime hold time: ${totalHoldSeconds}s`,
  ];
  return lines.join('\n');
}

/** Restores Settings + body-stat Profile to their defaults — workout history
 * is untouched. Useful for re-testing first-run/onboarding-shaped flows
 * without also wiping the training log those don't depend on. */
export function resetSettingsAndProfile(): void {
  useSettings.setState({
    hapticCues: true,
    repHaptics: true,
    repDing: true,
    voiceCoach: true,
    mirrorFrontCamera: true,
    countdownSec: 3,
    cameraFacing: 'front',
    workoutAlertStyle: 'sound',
  });
  useProfile.setState({ heightCm: null, weightKg: null, units: 'metric', sex: 'unspecified', age: null });
}

/**
 * Throws OUTSIDE the current call stack (a fresh macrotask) so it reaches
 * the global handler in globalErrorHandler.ts exactly like a real uncaught
 * crash would, instead of being swallowed by whatever try/catch called this —
 * the only way to actually verify the FatalErrorScreen path before shipping.
 */
export function triggerTestCrash(): void {
  setTimeout(() => {
    throw new Error('Test crash triggered from Settings → Developer');
  }, 0);
}
