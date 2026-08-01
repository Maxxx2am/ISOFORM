import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandKvStorage } from '@/storage/kv';
import { PROGRAMS, type TrainingProgram, type ProgramStep } from '@/exercises/programs';

type ProgramState = {
  activeProgramId: string | null;
  currentStepIndex: number;

  isActive: () => boolean;
  /** The active program definition, or undefined. */
  activeProgram: () => TrainingProgram | undefined;
  /** The current step definition, or undefined. */
  currentStep: () => ProgramStep | undefined;
  /** Start a new program (resets progress). */
  startProgram: (id: string) => void;
  /** Advance to the next step. Returns false if already at last step (program complete). */
  advanceStep: () => boolean;
  /** Quit the current program. */
  quitProgram: () => void;
};

export const useProgram = create<ProgramState>()(
  persist(
    (set, get) => ({
      activeProgramId: null,
      currentStepIndex: 0,

      isActive: () => get().activeProgramId != null,
      activeProgram: () => {
        const { activeProgramId } = get();
        return PROGRAMS.find((p) => p.id === activeProgramId);
      },
      currentStep: () => {
        const prog = get().activeProgram();
        return prog?.steps[get().currentStepIndex];
      },
      startProgram: (id) => set({ activeProgramId: id, currentStepIndex: 0 }),
      advanceStep: () => {
        const prog = get().activeProgram();
        const next = get().currentStepIndex + 1;
        if (!prog || next >= prog.steps.length) return false;
        set({ currentStepIndex: next });
        return true;
      },
      quitProgram: () => set({ activeProgramId: null, currentStepIndex: 0 }),
    }),
    {
      name: 'program-progress',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
