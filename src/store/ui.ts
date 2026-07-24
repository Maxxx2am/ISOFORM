/** Tiny shared UI state for things that don't belong in navigation params. */
import { create } from 'zustand';

type UiState = {
  /** True while a full-screen overlay (e.g. the purchase sheet) is open over a tab
   * screen, so the floating tab bar can hide instead of showing through it. */
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  overlayOpen: false,
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
}));
