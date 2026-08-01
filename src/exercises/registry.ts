/**
 * Remote-updatable exercise content, layered on top of the compiled-in
 * `EXERCISES` from `data.ts`. The remote file is DATA ONLY — it names
 * pre-shipped gate/angle functions by string key and supplies thresholds; it
 * never contains code, on purpose. Apple's App Store guideline 2.5.2
 * prohibits apps that download and execute code that changes their
 * behavior — a remote file full of new logic would risk exactly that. This
 * stays firmly on the safe side of that line: the same category of thing as
 * Firebase Remote Config or any other JSON-driven feature-flag system.
 *
 * What this unlocks without an app update: any exercise's text (name,
 * summary, cues, setup), any exercise's numeric thresholds (the actual
 * "someone reported this counts too easily, I tightened it" bug-fix case),
 * the changelog feed, and brand-new exercises AS LONG AS their gate/angle
 * logic can be built from the named helpers already shipped (the same ones
 * the current library already uses). A genuinely new way of reading the
 * body — a new gate heuristic, a new angle computation — still needs a real
 * app update; that's rare and is an honest limit, not a gap to paper over.
 */
import * as Network from 'expo-network';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  ARMS,
  ARMS_AND_HIPS,
  BODYLINE,
  ELBOW,
  ELBOW_AND_BODYLINE,
  EXERCISES as BASE_EXERCISES,
  HIP,
  HIP_AND_KNEE,
  KNEE,
  MIN_HIP,
  MIN_KNEE,
  STANDING,
  feetOffFloor,
  feetPlanted,
  isDipSupported,
  isHangingOnBar,
  isHorizontal,
  isInPlanche,
  isInverted,
  isProne,
  isWallSitting,
  oneLegForward,
  setActiveExercises,
} from '@/exercises/data';
import type {
  AttemptGate,
  CueSeverity,
  Exercise,
  ExerciseCategory,
  ExerciseMode,
  FormRule,
  Muscle,
} from '@/exercises/types';
import { zustandKvStorage } from '@/storage/kv';

/**
 * https://github.com/Maxxx2am/ISOFORM — confirmed public, default branch
 * `main`. `exercises.json` doesn't exist in the repo yet (checked via the
 * GitHub API — 404 on /contents/exercises.json as of 2026-07-24); refresh()
 * will fail closed (harmlessly — see the catch block below) until it's
 * committed to the repo root.
 */
const REMOTE_EXERCISES_URL = 'https://raw.githubusercontent.com/Maxxx2am/ISOFORM/main/exercises.json';

/** Named gate functions a remote config can select by string key — the exact
 * same functions the built-in exercises already use, nothing new. */
const GATE_REGISTRY: Record<string, AttemptGate> = {
  isProne: ({ landmarks }) => isProne(landmarks),
  isHangingOnBar: ({ landmarks }) => isHangingOnBar(landmarks),
  feetOffFloor: ({ landmarks }) => feetOffFloor(landmarks),
  isInverted: ({ landmarks }) => isInverted(landmarks),
  isInPlanche: ({ landmarks }) => isInPlanche(landmarks),
  oneLegForward: ({ landmarks }) => oneLegForward(landmarks),
  feetPlanted: ({ landmarks }) => feetPlanted(landmarks),
  isWallSitting: ({ landmarks }) => isWallSitting(landmarks),
  isDipSupported: ({ landmarks }) => isDipSupported(landmarks),
  isHorizontal: ({ landmarks }) => isHorizontal(landmarks),
};

/** Named angle functions a remote config can select by string key. */
const ANGLE_FN_REGISTRY: Record<string, Exercise['angles']> = {
  ELBOW,
  KNEE,
  HIP,
  BODYLINE,
  ELBOW_AND_BODYLINE,
  HIP_AND_KNEE,
  MIN_KNEE,
  MIN_HIP,
};

/** Named full-body visibility gates a remote *addition* can select for
 * `requiredJoints` — a small, deliberately limited set. */
const JOINT_SET_REGISTRY: Record<string, Exercise['requiredJoints']> = {
  STANDING,
  ARMS,
  ARMS_AND_HIPS,
};

export type ChangelogEntry = { version: number; date: string; title: string; body: string };

/** The common "cue fires when a named angle crosses a threshold" shape —
 * covers most of the existing hand-written form rules. Bespoke rules that
 * read raw landmark geometry directly (elbow-flare, kipping symmetry) aren't
 * expressible here and stay code-only; that's the honest limit noted above. */
type RemoteFormRuleSpec = {
  id: string;
  cue: string;
  say?: string;
  severity: CueSeverity;
  bodyPart?: FormRule['bodyPart'];
  angle: string;
  op: 'below' | 'above' | 'between';
  value?: number;
  min?: number;
  max?: number;
};

type RemoteExerciseOverride = Partial<{
  name: string;
  summary: string;
  howTo: string[];
  cues: string[];
  setup: string;
  targetAngle: number;
  rep: Partial<{ angle: string; downBelow: number; upAbove: number }>;
  hold: Partial<{ angle: string; minOk: number; maxOk: number }>;
  gauge: Partial<{ angle: string; label: string; downBelow: number; upAbove: number; target: number }>;
  /** GATE_REGISTRY key. */
  gate: string;
  /** Replaces the whole formRules array when present. */
  formRules: RemoteFormRuleSpec[];
}>;

type RemoteExerciseAddition = {
  slug: string;
  name: string;
  category: ExerciseCategory;
  mode: ExerciseMode;
  family: string;
  level: number;
  muscles: Muscle[];
  view: 'front' | 'side';
  summary: string;
  howTo: string[];
  cues: string[];
  setup?: string;
  hideLegs?: boolean;
  showBar?: boolean;
  /** JOINT_SET_REGISTRY key. */
  requiredJoints: string;
  /** GATE_REGISTRY key. */
  gate?: string;
  /** ANGLE_FN_REGISTRY key. */
  angles: string;
  rep?: { angle: string; downBelow: number; upAbove: number };
  hold?: { angle: string; minOk: number; maxOk: number };
  targetAngle?: number;
  gauge?: { angle: string; label: string; downBelow: number; upAbove: number; target: number };
  formRules?: RemoteFormRuleSpec[];
};

type RemoteExerciseFile = {
  version: number;
  changelog: ChangelogEntry[];
  overrides?: Record<string, RemoteExerciseOverride>;
  additions?: RemoteExerciseAddition[];
};

function buildFormRule(spec: RemoteFormRuleSpec): FormRule | null {
  if (!spec || typeof spec.id !== 'string' || typeof spec.cue !== 'string') return null;
  if (spec.severity !== 'info' && spec.severity !== 'warn') return null;
  if (typeof spec.angle !== 'string') return null;
  const angle = spec.angle;
  let test: FormRule['test'] | null = null;
  if (spec.op === 'below' && typeof spec.value === 'number') {
    const v = spec.value;
    test = ({ angles }) => angles[angle] != null && (angles[angle] as number) < v;
  } else if (spec.op === 'above' && typeof spec.value === 'number') {
    const v = spec.value;
    test = ({ angles }) => angles[angle] != null && (angles[angle] as number) > v;
  } else if (spec.op === 'between' && typeof spec.min === 'number' && typeof spec.max === 'number') {
    const lo = spec.min;
    const hi = spec.max;
    test = ({ angles }) => angles[angle] != null && (angles[angle] as number) > lo && (angles[angle] as number) < hi;
  }
  if (!test) return null;
  return { id: spec.id, cue: spec.cue, say: spec.say, severity: spec.severity, bodyPart: spec.bodyPart, test };
}

/** Patches `overrides` onto the base list — an unknown slug is ignored (a
 * typo in the remote file shouldn't crash anything), every field is
 * optional, and only what's actually specified gets changed. */
function applyOverrides(base: Exercise[], overrides: Record<string, RemoteExerciseOverride>): Exercise[] {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return base.map((ex) => {
    const o = overrides[ex.slug];
    if (!o) return ex;
    const patched: Exercise = { ...ex };
    if (o.name != null) patched.name = o.name;
    if (o.summary != null) patched.summary = o.summary;
    if (o.howTo != null) patched.howTo = o.howTo;
    if (o.cues != null) patched.cues = o.cues;
    if (o.setup != null) patched.setup = o.setup;
    if (o.targetAngle != null) patched.targetAngle = o.targetAngle;
    if (o.rep && ex.rep) patched.rep = { ...ex.rep, ...o.rep };
    if (o.hold && ex.hold) patched.hold = { ...ex.hold, ...o.hold };
    if (o.gauge && ex.gauge) patched.gauge = { ...ex.gauge, ...o.gauge };
    if (o.gate != null) {
      const g = GATE_REGISTRY[o.gate];
      if (g) patched.gate = g;
    }
    if (o.formRules != null) {
      patched.formRules = o.formRules.map(buildFormRule).filter((r): r is FormRule => r != null);
    }
    return patched;
  });
}

/** Builds new Exercise objects from `additions`. Anything referencing an
 * unknown gate/angle/joint-set key, or missing a required field, is skipped
 * rather than crashing the merge — one bad entry in the remote file can't
 * take the rest of the app down. */
function buildAdditions(additions: RemoteExerciseAddition[]): Exercise[] {
  const out: Exercise[] = [];
  for (const a of additions) {
    try {
      if (!a || typeof a.slug !== 'string' || typeof a.name !== 'string') continue;
      const anglesFn = ANGLE_FN_REGISTRY[a.angles];
      if (!anglesFn) continue;
      if (a.gate && !GATE_REGISTRY[a.gate]) continue; // named a gate that doesn't exist — skip, don't guess
      const requiredJoints = JOINT_SET_REGISTRY[a.requiredJoints] ?? STANDING;
      const formRules = (a.formRules ?? []).map(buildFormRule).filter((r): r is FormRule => r != null);
      out.push({
        id: a.slug,
        slug: a.slug,
        name: a.name,
        category: a.category,
        mode: a.mode,
        tracked: !!(a.rep || a.hold),
        family: a.family,
        level: a.level,
        muscles: a.muscles,
        summary: a.summary,
        howTo: a.howTo,
        cues: a.cues,
        setup: a.setup,
        view: a.view,
        hideLegs: a.hideLegs,
        showBar: a.showBar,
        requiredJoints,
        targetAngle: a.targetAngle,
        gauge: a.gauge,
        angles: anglesFn,
        rep: a.rep,
        hold: a.hold,
        gate: a.gate ? GATE_REGISTRY[a.gate] : undefined,
        formRules,
      });
    } catch {
      // One malformed entry never takes down the rest of the merge.
    }
  }
  return out;
}

function mergeExercises(
  overrides: Record<string, RemoteExerciseOverride>,
  additions: RemoteExerciseAddition[],
): Exercise[] {
  const overridden = applyOverrides(BASE_EXERCISES, overrides);
  const added = buildAdditions(additions);
  // An addition reusing an existing slug replaces the base entry rather than
  // duplicating it — lets a remote fix eventually "graduate" into a full
  // redefinition without leaving the old one behind.
  const addedSlugs = new Set(added.map((e) => e.slug));
  return [...overridden.filter((e) => !addedSlugs.has(e.slug)), ...added];
}

type RegistryState = {
  remoteVersion: number;
  changelog: ChangelogEntry[];
  overrides: Record<string, RemoteExerciseOverride>;
  additions: RemoteExerciseAddition[];
  /** Drives the "What's New" unread badge in Settings. */
  lastSeenVersion: number;
  lastCheckedAt: number | null;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markChangelogSeen: () => void;
};

export const useExerciseRegistry = create<RegistryState>()(
  persist(
    (set, get) => ({
      remoteVersion: 0,
      changelog: [],
      overrides: {},
      additions: [],
      lastSeenVersion: 0,
      lastCheckedAt: null,
      refreshing: false,
      error: null,
      refresh: async () => {
        if (get().refreshing) return;
        console.log('[registry] refresh started');
        set({ refreshing: true, error: null });
        try {
          console.log('[registry] fetching', REMOTE_EXERCISES_URL);
          const res = (await Promise.race([
            fetch(REMOTE_EXERCISES_URL, { headers: { Accept: 'application/json' } }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
          ])) as Response;
          console.log('[registry] fetch done, status:', res.status, 'ok:', res.ok);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as Partial<RemoteExerciseFile>;
          console.log('[registry] json parsed, version:', json.version);
          if (typeof json.version !== 'number') throw new Error('Remote file missing "version"');
          const overrides = json.overrides && typeof json.overrides === 'object' ? json.overrides : {};
          const additions = Array.isArray(json.additions) ? json.additions : [];
          const changelog = Array.isArray(json.changelog) ? json.changelog : [];
          console.log('[registry] done — v', json.version, '| changelog entries:', changelog.length);
          set({
            remoteVersion: json.version,
            changelog,
            overrides,
            additions,
            lastCheckedAt: Date.now(),
            refreshing: false,
          });
        } catch (e) {
          console.log('[registry] refresh failed:', e instanceof Error ? e.message : String(e));
          set({ refreshing: false, error: e instanceof Error ? e.message : String(e), lastCheckedAt: Date.now() });
        }
      },
      markChangelogSeen: () => set((s) => ({ lastSeenVersion: s.remoteVersion })),
    }),
    {
      name: 'exercise-registry',
      storage: createJSONStorage(() => zustandKvStorage),
      partialize: (state) => {
        const { refreshing, error, ...rest } = state;
        void refreshing; void error;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('[registry] rehydrated — resetting refreshing/error');
          state.refreshing = false;
          state.error = null;
        }
      },
    },
  ),
);

// Keeps data.ts's getExercise/getNextProgression/getPrevProgression (used by
// every screen except the few below that need the whole catalog reactively)
// in sync with the registry. This single subscription covers BOTH cases —
// the persisted overrides/additions loading from disk on startup, and every
// future refresh() — since zustand's persist middleware rehydrates through
// the same set() path a normal update does, so both fire this listener.
useExerciseRegistry.subscribe((state) => {
  setActiveExercises(mergeExercises(state.overrides, state.additions));
});
// Applied once immediately too (the subscription above only fires on the
// NEXT change), so getExercise() is never looking at a stale/undefined list
// in the brief moment before rehydration completes — this just re-applies
// the default (pre-hydration) state, which is BASE_EXERCISES unchanged.
setActiveExercises(mergeExercises(useExerciseRegistry.getState().overrides, useExerciseRegistry.getState().additions));

/** Don't re-check on every WiFi blip (a flappy connection reconnecting
 * repeatedly, or the listener firing once per app the OS considers "the
 * network changed") — once every 15 minutes at most is plenty for content
 * that changes rarely, and keeps this from ever being a source of jank or
 * needless network/battery use. */
const MIN_RECHECK_INTERVAL_MS = 15 * 60 * 1000;

// Auto-refresh whenever the device joins WiFi (not cellular — a background
// content check shouldn't spend someone's mobile data), on top of the
// once-at-launch check in _layout.tsx. The two triggers cover different
// cases: launch catches "already on WiFi when the app opens," this catches
// "was offline, just connected." Both go through the same `refresh()`,
// which is already non-blocking and fails closed — this listener is just
// deciding WHEN to call it, not doing any work itself, so it can't be the
// thing that makes the app feel laggy.
Network.addNetworkStateListener((state) => {
  if (state.type !== Network.NetworkStateType.WIFI || !state.isConnected) return;
  const lastCheckedAt = useExerciseRegistry.getState().lastCheckedAt;
  if (lastCheckedAt != null && Date.now() - lastCheckedAt < MIN_RECHECK_INTERVAL_MS) return;
  useExerciseRegistry.getState().refresh();
});

/**
 * Reactive merged exercise list, for the handful of screens that display or
 * iterate the WHOLE catalog and need to re-render when remote content
 * changes (Train screen, workout builder, rank-check). Anything that just
 * wants one exercise by slug, or the next/prev step in a family, should keep
 * using `getExercise`/`getNextProgression`/`getPrevProgression` from
 * `@/exercises/data` instead — those already transparently reflect remote
 * content with no changes needed at the call site.
 */
export function useActiveExercises(): Exercise[] {
  const overrides = useExerciseRegistry((s) => s.overrides);
  const additions = useExerciseRegistry((s) => s.additions);
  return useMemo(() => mergeExercises(overrides, additions), [overrides, additions]);
}

/** Non-reactive equivalent of `useActiveExercises` for plain functions that
 * aren't React components (e.g. `lib/devTools.ts`'s demo-data seeder) and
 * just need a one-off snapshot of the current merged list. */
export function getActiveExercises(): Exercise[] {
  const state = useExerciseRegistry.getState();
  return mergeExercises(state.overrides, state.additions);
}
