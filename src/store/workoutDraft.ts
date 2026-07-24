/** In-memory (not persisted) handoff for an ad-hoc "Start workout" run — the
 * exercises/goals picked on the spot, never saved as a template. Same reason
 * as workoutRun.ts's finished-run handoff: this only needs to survive the one
 * navigation from the picker into the runner. */
import { create } from 'zustand';

import type { WorkoutStep } from '@/store/workouts';

type WorkoutDraft = { name: string; steps: WorkoutStep[] };

type WorkoutDraftStore = {
  draft: WorkoutDraft | null;
  setDraft: (d: WorkoutDraft) => void;
  clearDraft: () => void;
};

export const useWorkoutDraft = create<WorkoutDraftStore>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));
