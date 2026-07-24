/** Persisted saved workouts (ordered exercise lists with goals) + per-exercise
 * goal presets, so building a workout is picking from your own numbers
 * instead of retyping them every time. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';

export type ExerciseGoal = {
  type: 'reps' | 'hold';
  /** One or more rep/hold-second checkpoints, ascending — a long hold can have
   * several (e.g. handstand: 30s, 60s, 90s), each announced as you pass it,
   * so you know where you are mid-set instead of only a single end target. */
  values: number[];
};

export type WorkoutStep = {
  id: string;
  exerciseSlug: string;
  goal: ExerciseGoal;
};

export type SavedWorkout = {
  id: string;
  name: string;
  steps: WorkoutStep[];
  createdAt: number;
};

type WorkoutsState = {
  workouts: SavedWorkout[];
  /** Raw goal values a user has saved per exercise slug (unit implied by the
   * exercise's own mode) — e.g. handstand: [30, 60, 75]. */
  goalPresets: Record<string, number[]>;
  addWorkout: (w: SavedWorkout) => void;
  updateWorkout: (id: string, patch: Partial<Omit<SavedWorkout, 'id'>>) => void;
  deleteWorkout: (id: string) => void;
  addGoalPreset: (slug: string, value: number) => void;
  removeGoalPreset: (slug: string, value: number) => void;
};

export const useWorkouts = create<WorkoutsState>()(
  persist(
    (set) => ({
      workouts: [],
      goalPresets: {},
      addWorkout: (w) => set((s) => ({ workouts: [...s.workouts, w] })),
      updateWorkout: (id, patch) =>
        set((s) => ({ workouts: s.workouts.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      deleteWorkout: (id) => set((s) => ({ workouts: s.workouts.filter((w) => w.id !== id) })),
      addGoalPreset: (slug, value) =>
        set((s) => {
          const existing = s.goalPresets[slug] ?? [];
          if (existing.includes(value)) return s;
          return { goalPresets: { ...s.goalPresets, [slug]: [...existing, value].sort((a, b) => a - b) } };
        }),
      removeGoalPreset: (slug, value) =>
        set((s) => ({
          goalPresets: { ...s.goalPresets, [slug]: (s.goalPresets[slug] ?? []).filter((v) => v !== value) },
        })),
    }),
    {
      // Bumped: ExerciseGoal's shape changed from a single `value` to a
      // `values` checkpoint array — old persisted data under the previous
      // name would otherwise load with the wrong shape and crash on read.
      name: 'workouts-v2',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
