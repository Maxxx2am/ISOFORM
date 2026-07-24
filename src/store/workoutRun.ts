/**
 * In-memory handoff for a just-finished WORKOUT (a sequence of exercise
 * steps) — same reasoning as store/session.ts's single-session handoff:
 * timelines/summaries are too big for route params, and this is only ever
 * read once by the summary screen right after the runner finishes.
 */
import { create } from 'zustand';

import type { SessionSummary } from '@/engine/sessionEngine';
import type { ExerciseGoal } from '@/store/workouts';

export type WorkoutRunStep = {
  exerciseName: string;
  exerciseSlug: string;
  summary: SessionSummary;
  goal: ExerciseGoal;
  /** This exercise's best reps/hold-seconds BEFORE this step, looked up at
   * finalize time — null if this was the first-ever tracked result for it. */
  previousBest: number | null;
};

export type FinishedWorkoutRun = {
  workoutName: string;
  steps: WorkoutRunStep[];
};

type WorkoutRunStore = {
  finished: FinishedWorkoutRun | null;
  setFinished: (r: FinishedWorkoutRun) => void;
  clear: () => void;
};

export const useWorkoutRunStore = create<WorkoutRunStore>((set) => ({
  finished: null,
  setFinished: (finished) => set({ finished }),
  clear: () => set({ finished: null }),
}));
