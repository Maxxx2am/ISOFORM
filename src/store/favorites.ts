import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandKvStorage } from '@/storage/kv';

type FavoritesState = {
  favorites: string[];
  toggle: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
};

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggle: (slug: string) => {
        const current = get().favorites;
        if (current.includes(slug)) {
          set({ favorites: current.filter((s) => s !== slug) });
        } else {
          set({ favorites: [...current, slug] });
        }
      },
      isFavorite: (slug: string) => get().favorites.includes(slug),
    }),
    {
      name: 'favorites',
      storage: createJSONStorage(() => zustandKvStorage),
    },
  ),
);
