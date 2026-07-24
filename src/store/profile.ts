/** Persisted body stats (optional) — used only to adjust the calisthenics
 * rank estimate in Insights. Always stored canonically in cm/kg; `units`
 * only controls what Settings displays/accepts. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';

export type UnitSystem = 'metric' | 'imperial';
/** 'unspecified' = "prefer not to say" — a real, first-class choice, not a
 * missing value, so it's never nagged for or treated as incomplete. */
export type Sex = 'male' | 'female' | 'unspecified';

type ProfileState = {
  heightCm: number | null;
  weightKg: number | null;
  units: UnitSystem;
  sex: Sex;
  age: number | null;
  setHeightCm: (cm: number | null) => void;
  setWeightKg: (kg: number | null) => void;
  setUnits: (u: UnitSystem) => void;
  setSex: (s: Sex) => void;
  setAge: (age: number | null) => void;
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      heightCm: null,
      weightKg: null,
      units: 'metric',
      sex: 'unspecified',
      age: null,
      setHeightCm: (heightCm) => set({ heightCm }),
      setWeightKg: (weightKg) => set({ weightKg }),
      setUnits: (units) => set({ units }),
      setSex: (sex) => set({ sex }),
      setAge: (age) => set({ age }),
    }),
    {
      name: 'profile',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return inches === 12 ? { feet: feet + 1, inches: 0 } : { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function kgToLb(kg: number): number {
  return kg * 2.2046226;
}

export function lbToKg(lb: number): number {
  return lb / 2.2046226;
}
