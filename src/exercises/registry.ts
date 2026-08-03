import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { create } from 'zustand';
import { EXERCISES, setActiveExercises } from './data';
import type { Exercise } from './types';

type ChangelogEntry = { version: number; date: string; title: string; body: string };
type RemoteOverrides = Record<string, { rep?: { downBelow?: number; upAbove?: number }; hold?: { minOk?: number; maxOk?: number }; gauge?: { downBelow?: number; upAbove?: number } }>;

interface Manifest { version: number; changelog: ChangelogEntry[]; overrides: RemoteOverrides }

const REMOTE = 'https://raw.githubusercontent.com/Maxxx2am/ISOFORM/master/exercises.json';
const API_REMOTE = 'https://api.github.com/repos/Maxxx2am/ISOFORM/contents/exercises.json?ref=master';
const KEY = 'exercise-registry';

function mergeList(list: Exercise[], ov: RemoteOverrides): Exercise[] {
  return list.map((ex) => {
    const o = ov[ex.slug]; if (!o) return ex;
    const e = { ...ex };
    if (o.rep && e.rep) e.rep = { ...e.rep, ...o.rep };
    if (o.hold && e.hold) e.hold = { ...e.hold, ...o.hold };
    if (o.gauge && e.gauge) e.gauge = { ...e.gauge, ...o.gauge };
    return e;
  });
}

async function fetchManifest(): Promise<Manifest> {
  const candidates: Manifest[] = [];
  try {
    const response = await fetch(`${REMOTE}?v=${Date.now()}`);
    if (response.ok) candidates.push(await response.json() as Manifest);
  } catch {}
  // Raw GitHub can briefly serve an older cached blob. The contents API is
  // used only as a fallback and lets a manual refresh see the current commit.
  try {
    const response = await fetch(API_REMOTE, { headers: { Accept: 'application/vnd.github+json' } });
    if (response.ok) {
      const file = await response.json() as { content?: string; encoding?: string };
      if (file.content && file.encoding === 'base64') {
        candidates.push(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as Manifest);
      }
    }
  } catch {}
  const latest = candidates.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  if (!latest) throw new Error('Unable to fetch exercise updates');
  return latest;
}

type RegistryState = {
  exercises: Exercise[];
  remoteVersion: number;
  lastSeenVersion: number;
  lastCheckedAt: number | null;
  changelog: ChangelogEntry[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  markSeen: () => Promise<void>;
  markChangelogSeen: () => Promise<void>;
};

const store = create<RegistryState>((set, get) => ({
  exercises: EXERCISES,
  remoteVersion: 0,
  lastSeenVersion: 0,
  lastCheckedAt: null,
  changelog: [],
  refreshing: false,

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const m = await fetchManifest();
      if (m.overrides) {
        const exercises = mergeList(EXERCISES, m.overrides);
        setActiveExercises(exercises);
        set({ exercises });
      }
      set({ remoteVersion: m.version ?? 0, changelog: m.changelog ?? [], lastCheckedAt: Date.now() });
    } catch {}
    finally {
      set({ refreshing: false, lastCheckedAt: Date.now() });
      try { await AsyncStorage.setItem(KEY, JSON.stringify({ seen: get().lastSeenVersion, checked: get().lastCheckedAt, log: get().changelog })); } catch {}
    }
  },

  markSeen: async () => {
    set({ lastSeenVersion: get().remoteVersion });
    try { await AsyncStorage.setItem(KEY, JSON.stringify({ seen: get().lastSeenVersion, checked: get().lastCheckedAt, log: get().changelog })); } catch {}
  },

  markChangelogSeen: async () => {
    set({ lastSeenVersion: get().remoteVersion });
    try { await AsyncStorage.setItem(KEY, JSON.stringify({ seen: get().lastSeenVersion, checked: get().lastCheckedAt, log: get().changelog })); } catch {}
  },
}));

// Hydrate on module load
(async () => {
  try {
    const r = await AsyncStorage.getItem(KEY);
    if (r) { const s = JSON.parse(r); store.setState({ lastSeenVersion: s.seen ?? 0, lastCheckedAt: s.checked ?? null, changelog: s.log ?? [], remoteVersion: s.seen ?? 0 }); }
  } catch {}
})();

export const useExerciseRegistry = store;
export function useActiveExercises() { return store((s) => s.exercises); }
export const getActiveExercises = () => store.getState().exercises;

let autoStarted = false;
export function startAutoRefresh() { if (!autoStarted) { autoStarted = true; store.getState().refresh(); } }
