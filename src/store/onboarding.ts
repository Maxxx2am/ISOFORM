/** Whether the user has ever completed the first-run welcome/trust flow. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';

type OnboardingState = {
  hasOnboarded: boolean;
  /** False until the persisted value has actually loaded — without this, a
   * returning user could see a one-frame flash of onboarding again on every
   * launch, since `hasOnboarded` starts at its default (false) until the
   * async storage read resolves. */
  hasHydrated: boolean;
  setHasOnboarded: (v: boolean) => void;
};

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      hasHydrated: false,
      setHasOnboarded: (hasOnboarded) => set({ hasOnboarded }),
    }),
    {
      name: 'onboarding',
      storage: createJSONStorage(() => zustandKvStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasHydrated = true;
      },
    },
  ),
);
