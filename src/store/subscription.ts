import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandKvStorage } from '@/storage/kv';

/** The only exercise available without All Access. */
export const FREE_EXERCISES = ['pushup'];

/**
 * Single source of truth for what's unlocked: Push-Up is always free,
 * everything else needs All Access. There is deliberately no per-exercise
 * unlock — the "buy" buttons in the UI are inert placeholders (no real
 * payments yet), and the only way to actually unlock anything is the
 * "All Access" toggle in Settings.
 */
type SubscriptionState = {
  hasAllAccess: boolean;
  isExerciseUnlocked: (slug: string) => boolean;
  grantAllAccess: () => void;
  revokeAllAccess: () => void;
};

export const useSubscription = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      hasAllAccess: false,
      isExerciseUnlocked: (slug: string) => get().hasAllAccess || FREE_EXERCISES.includes(slug),
      grantAllAccess: () => set({ hasAllAccess: true }),
      revokeAllAccess: () => set({ hasAllAccess: false }),
    }),
    {
      // Bumped so any device carrying the old per-exercise `ownedExercises`
      // list (from before "buy" was made a no-op) starts clean instead of
      // that stale array silently unlocking exercises again.
      name: 'subscription-v2',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
