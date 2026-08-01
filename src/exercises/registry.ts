import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { EXERCISES, setActiveExercises } from './data';
import type { Exercise } from './types';

type ChangelogEntry = { version: number; date: string; title: string; body: string };
type RemoteOverrides = Record<string, { rep?: { downBelow?: number; upAbove?: number }; hold?: { minOk?: number; maxOk?: number }; gauge?: { downBelow?: number; upAbove?: number } }>;

interface Manifest { version: number; changelog: ChangelogEntry[]; overrides: RemoteOverrides }

const REMOTE = 'https://raw.githubusercontent.com/Maxxx2am/ISOFORM/master/exercises.json';
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

type RegistryState = {
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
  remoteVersion: 0,
  lastSeenVersion: 0,
  lastCheckedAt: null,
  changelog: [],
  refreshing: false,

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const resp = await fetch(REMOTE);
      if (resp.ok) {
        const m: Manifest = await resp.json();
        if (m.overrides) setActiveExercises(mergeList(EXERCISES, m.overrides));
        set({ remoteVersion: m.version ?? 0, changelog: m.changelog ?? [], lastCheckedAt: Date.now() });
      }
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
export function useActiveExercises() { return EXERCISES; }
export const getActiveExercises = () => EXERCISES;

let autoStarted = false;
export function startAutoRefresh() { if (!autoStarted) { autoStarted = true; store.getState().refresh(); } }
