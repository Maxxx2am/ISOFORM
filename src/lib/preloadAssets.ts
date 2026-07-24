/**
 * Warms the local-image cache for every rank/achievement/streak icon as early
 * as possible (app launch), not the first time each one is actually displayed.
 *
 * In Expo Go, a `require()`'d local image isn't bundled into the app the way
 * it is in a real build — the JS bundle just holds a reference, and the
 * actual PNG bytes are fetched from the dev server (over Wi-Fi/USB/tunnel)
 * the first time something tries to render it. The images themselves are
 * small, but that per-asset network round trip is what read as "icons take a
 * while to load" — and only on a fresh app open, since once fetched they're
 * cached and every later switch is instant. This won't exist at all once the
 * app ships as a real build (assets get bundled at build time), but there's
 * no reason to wait on that to make Expo Go testing feel snappy.
 */
import { Asset } from 'expo-asset';

import { ACHIEVEMENT_BADGES } from '@/lib/achievements';
import { RANK_ICONS } from '@/lib/rank';

export function preloadAppImages(): void {
  const modules = [...Object.values(RANK_ICONS), ...Object.values(ACHIEVEMENT_BADGES), require('../../assets/images/streak/flame.png')];
  // Best-effort — a failed prefetch just means the normal first-display
  // decode happens instead, never a crash.
  Asset.loadAsync(modules).catch(() => {});
}
