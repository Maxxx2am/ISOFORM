import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export interface ChangelogEntry {
  version: number;
  date: string;
  title: string;
  body: string;
}

interface RemoteManifest {
  version: number;
  changelog: ChangelogEntry[];
  overrides: Record<string, unknown>;
  additions: unknown[];
}

interface StoredState {
  lastSeenVersion: number;
  lastCheckedAt: number | null;
  changelog: ChangelogEntry[];
}

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
  } catch {}
  return { lastSeenVersion: 0, lastCheckedAt: null, changelog: [] };
}

async function saveStored(s: StoredState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

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
export function startAutoRefresh() {
  if (_autoStarted) return;
  _autoStarted = true;
  hydrate().then(() => refresh());
}

export function useExerciseRegistry() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
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
