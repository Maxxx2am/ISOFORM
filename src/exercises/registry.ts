/**
 * ─── REMOTE EXERCISE CONFIG SYNC ───
 *
 * HOW IT WORKS:
 *   1. On app launch, `startAutoRefresh()` fetches the latest exercises.json
 *      from the GitHub repo's raw URL.
 *   2. The fetched manifest contains:
 *      - "version": a number — bump this every time you change exercises.json.
 *        The Settings widget shows a green "new" dot when remoteVersion > lastSeenVersion.
 *      - "changelog": shown in the Settings → Content Updates widget.
 *      - "overrides": patch compiled exercise thresholds (rep/hold/gauge) at
 *        runtime WITHOUT a new app build. Keyed by exercise slug.
 *      - "additions": reserved for future new-exercise JSON delivery (not yet wired).
 *   3. Overrides are merged into the compiled EXERCISES list and pushed via
 *      `setActiveExercises()`. All `getExercise()` / `getNextProgression()` /
 *      `getPrevProgression()` calls immediately see the patched thresholds.
 *
 * PUBLISH FLOW (no build required):
 *   a) Edit exercises.json at the repo root — bump "version", patch overrides
 *      if needed, append a changelog entry.
 *   b) Git commit & push to master.
 *   c) On next app launch, the registry fetches the new JSON, applies
 *      thresholds, and the widget shows the green "new" dot + latest changelog.
 *
 * RELATED FILES:
 *   - exercises.json (repo root)          — remote manifest
 *   - src/exercises/data.ts               — compiled EXERCISES fallback + setActiveExercises()
 *   - src/exercises/types.ts              — Exercise, RepConfig, HoldConfig types
 *   - src/app/(tabs)/settings.tsx         — ContentUpdatesWidget
 *   - src/app/_layout.tsx                 — startAutoRefresh() call on launch
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import {
  EXERCISES,
  setActiveExercises,
} from './data';
import type { Exercise, RepConfig, HoldConfig } from './types';

export interface ChangelogEntry {
  version: number;
  date: string;
  title: string;
  body: string;
}

interface RemoteOverride {
  rep?: Partial<RepConfig>;
  hold?: Partial<HoldConfig>;
  gauge?: { downBelow?: number; upAbove?: number };
}

interface RemoteManifest {
  version: number;
  changelog: ChangelogEntry[];
  overrides: Record<string, RemoteOverride>;
  additions: unknown[];
}

interface StoredState {
  lastSeenVersion: number;
  lastCheckedAt: number | null;
  changelog: ChangelogEntry[];
}

/**
 * Public raw URL of exercises.json on the master branch.
 * GitHub serves this with a 5-min CDN cache — a manual refresh in the app
 * (the refresh button in Settings) uses `cache: 'no-cache'` to bypass it,
 * but the auto-fetch on launch may serve a stale version briefly.
 */
const REMOTE_URL =
  'https://raw.githubusercontent.com/Maxxx2am/ISOFORM/master/exercises.json';
const STORAGE_KEY = 'exercise-registry';

function now(): number {
  return Date.now();
}

async function loadStored(): Promise<StoredState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredState;
  } catch {
    /* first launch — no stored state */
  }
  return { lastSeenVersion: 0, lastCheckedAt: null, changelog: [] };
}

async function saveStored(s: StoredState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or cleared — non-fatal, just won't persist this cycle */
  }
}

/**
 * Deep-clone an exercise and patch its rep/hold/gauge thresholds from
 * the remote override. Returns the patched exercise, or the original if
 * no overrides apply.
 *
 * This is intentionally shallow — it only patches the threshold numbers.
 * The angles() function, gate, formRules, etc. stay as compiled. Remote
 * configs are data-only, never code.
 */
function applyOverride(
  exercise: Exercise,
  override: RemoteOverride,
): Exercise {
  const patched = { ...exercise };

  if (override.rep && patched.rep) {
    patched.rep = {
      ...patched.rep,
      ...(override.rep.downBelow != null ? { downBelow: override.rep.downBelow } : {}),
      ...(override.rep.upAbove != null ? { upAbove: override.rep.upAbove } : {}),
    };
  }

  if (override.hold && patched.hold) {
    patched.hold = {
      ...patched.hold,
      ...(override.hold.minOk != null ? { minOk: override.hold.minOk } : {}),
      ...(override.hold.maxOk != null ? { maxOk: override.hold.maxOk } : {}),
    };
  }

  if (override.gauge && patched.gauge) {
    patched.gauge = {
      ...patched.gauge,
      ...(override.gauge.downBelow != null ? { downBelow: override.gauge.downBelow } : {}),
      ...(override.gauge.upAbove != null ? { upAbove: override.gauge.upAbove } : {}),
    };
  }

  return patched;
}

/** Build the merged exercise list by patching compiled EXERCISES with
 *  remote overrides. Called after every successful fetch. */
function buildMergedExercises(overrides: Record<string, RemoteOverride>): Exercise[] {
  return EXERCISES.map((ex) => {
    const patch = overrides[ex.slug];
    return patch ? applyOverride(ex, patch) : ex;
  });
}

// ─── module-scoped reactive state ───

let _remoteVersion = 0;
let _changelog: ChangelogEntry[] = [];
let _refreshing = false;
let _lastCheckedAt: number | null = null;
let _lastSeenVersion = 0;
let _hydrated = false;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function hydrate() {
  if (_hydrated) return;
  _hydrated = true;
  const s = await loadStored();
  _lastSeenVersion = s.lastSeenVersion;
  _lastCheckedAt = s.lastCheckedAt;
  _changelog = s.changelog;
  _remoteVersion = s.lastSeenVersion;
}

/**
 * Fetch the latest exercises.json from GitHub, merge overrides into the
 * active exercise list, and persist the changelog + version state.
 *
 * Called automatically on launch (via startAutoRefresh) and manually
 * from the Settings widget's refresh button.
 */
export async function refresh(): Promise<void> {
  if (_refreshing) return;
  _refreshing = true;
  notify();
  try {
    const resp = await fetch(REMOTE_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const manifest = (await resp.json()) as RemoteManifest;
    _remoteVersion = manifest.version;
    _changelog = manifest.changelog;
    _lastCheckedAt = now();

    setActiveExercises(buildMergedExercises(manifest.overrides ?? {}));

    await saveStored({
      lastSeenVersion: _lastSeenVersion,
      lastCheckedAt: _lastCheckedAt,
      changelog: _changelog,
    });
  } catch {
    _lastCheckedAt = now();
    await saveStored({
      lastSeenVersion: _lastSeenVersion,
      lastCheckedAt: _lastCheckedAt,
      changelog: _changelog,
    });
  } finally {
    _refreshing = false;
    notify();
  }
}

/**
 * Mark the current remote version as "seen" so the green "new" dot
 * disappears. Called when the user taps the widget or closes it.
 */
export async function markSeen(): Promise<void> {
  _lastSeenVersion = _remoteVersion;
  await saveStored({
    lastSeenVersion: _lastSeenVersion,
    lastCheckedAt: _lastCheckedAt,
    changelog: _changelog,
  });
  notify();
}

let _autoStarted = false;

/**
 * Kick off the background fetch AFTER the first screen has rendered.
 * Call once from the root layout — safe to call multiple times
 * (idempotent).
 */
export function startAutoRefresh() {
  if (_autoStarted) return;
  _autoStarted = true;
  hydrate().then(() => refresh());
}

/**
 * React hook for the Settings screen's ContentUpdatesWidget.
 * Returns live module-scoped state + refresh / markSeen actions.
 */
export function useExerciseRegistry() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  return {
    remoteVersion: _remoteVersion,
    lastSeenVersion: _lastSeenVersion,
    lastCheckedAt: _lastCheckedAt,
    changelog: _changelog,
    refreshing: _refreshing,
    refresh,
    markSeen,
  };
}
