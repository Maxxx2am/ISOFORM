/**
 * In-memory handoff for the just-finished set. The replay/review screen reads
 * this (timelines are too big for route params); history persistence is
 * separate (see storage/db.ts).
 */
import { create } from 'zustand';

import type { SessionSummary, TimelineSample } from '@/engine/sessionEngine';

export type FinishedSession = {
  id: string;
  exerciseName: string;
  createdAt: number;
  summary: SessionSummary;
  timeline: TimelineSample[];
  videoUri: string | null;
  /** Recorded video width/height ratio, for aligning the replay overlay. */
  videoAspect?: number;
  /** This exercise's best reps/hold-seconds BEFORE this set, looked up at
   * finalize time — null if this is the first-ever tracked result for it.
   * Lets the review screen show a "new record" moment without recomputing
   * or misfiring on a reopened history session (this field never persists). */
  previousBest: number | null;
};

type SessionStore = {
  finished: FinishedSession | null;
  setFinished: (s: FinishedSession) => void;
  clear: () => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  finished: null,
  setFinished: (finished) => set({ finished }),
  clear: () => set({ finished: null }),
}));
