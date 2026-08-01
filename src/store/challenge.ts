import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandKvStorage } from '@/storage/kv';

export interface ChallengeResult {
  date: string;
  challengeId: string;
  exerciseSlug: string;
  target: number;
  score: number | null;
  /** Best single-set metric achieved that day. */
  bestReps: number;
  bestHoldSeconds: number;
}

type ChallengeState = {
  /** Challenge results indexed by date string ("2026-08-01"). */
  history: Record<string, ChallengeResult>;
  /** The challenge the user is currently attempting. */
  active: {
    challengeId: string;
    target: number;
    exerciseSlug: string;
  } | null;

  setActive: (challengeId: string, target: number, exerciseSlug: string) => void;
  clearActive: () => void;
  saveResult: (result: ChallengeResult) => void;
  /** Get the last N results for a specific exercise. */
  getHistoryFor: (exerciseSlug: string, limit?: number) => ChallengeResult[];
};

export const useChallengeStore = create<ChallengeState>()(
  persist(
    (set, get) => ({
      history: {},
      active: null,

      setActive: (challengeId, target, exerciseSlug) =>
        set({ active: { challengeId, target, exerciseSlug } }),

      clearActive: () => set({ active: null }),

      saveResult: (result) =>
        set((s) => ({
          history: { ...s.history, [result.date]: result },
        })),

      getHistoryFor: (exerciseSlug, limit = 10) => {
        const all = Object.values(get().history)
          .filter((r) => r.exerciseSlug === exerciseSlug)
          .sort((a, b) => b.date.localeCompare(a.date));
        return all.slice(0, limit);
      },
    }),
    {
      name: 'challenge-history',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
