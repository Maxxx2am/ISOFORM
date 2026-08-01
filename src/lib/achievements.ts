/** Milestone achievements computed purely from local session history — no
 * new persisted state, just a check run over what's already logged. */
import { Ionicons } from '@expo/vector-icons';
import type { ImageSourcePropType } from 'react-native';

import type { SessionRecord } from '@/storage/db';

export type BadgeColor = 'brown' | 'steel' | 'copper' | 'lavender' | 'gold' | 'rainbow' | 'pink' | 'blue';

/** Same reasoning as the rank icons — render at a fixed height using this
 * aspect ratio instead of squeezing every badge into an identical square, so
 * the winged variants don't shrink relative to the plain hexagon ones. */
export const BADGE_ASPECT: Record<BadgeColor, number> = {
  brown: 127 / 141,
  steel: 127 / 141,
  copper: 126 / 141,
  lavender: 192 / 141,
  gold: 191 / 140,
  rainbow: 200 / 140,
  pink: 192 / 140,
  blue: 197 / 140,
};

/** Tint for the little icon overlaid on each badge — flat black read as a
 * dull silhouette (and clashed hard on the darker badges), so each one gets a
 * bright tone pulled from its own badge instead. */
export const BADGE_ICON_COLOR: Record<BadgeColor, string> = {
  brown: '#F0C89A',
  steel: '#EAF2F8',
  copper: '#FFC9A3',
  lavender: '#F1E9FF',
  gold: '#FFE8A3',
  rainbow: '#FFFFFF',
  pink: '#FFE1EF',
  blue: '#E3F5FF',
};

export const ACHIEVEMENT_BADGES: Record<BadgeColor, ImageSourcePropType> = {
  brown: require('../../assets/images/achievements/brown.png'),
  steel: require('../../assets/images/achievements/steel.png'),
  copper: require('../../assets/images/achievements/copper.png'),
  lavender: require('../../assets/images/achievements/lavender.png'),
  gold: require('../../assets/images/achievements/gold.png'),
  rainbow: require('../../assets/images/achievements/rainbow.png'),
  pink: require('../../assets/images/achievements/pink.png'),
  blue: require('../../assets/images/achievements/blue.png'),
};

type AchievementContext = {
  sessions: SessionRecord[];
};

export type Achievement = {
  id: string;
  title: string;
  /** Short enough to sit under the badge without truncating — the full
   * `title` still shows when the tile is tapped. */
  shortTitle: string;
  description: string;
  badge: BadgeColor;
  icon: keyof typeof Ionicons.glyphMap;
  check: (ctx: AchievementContext) => boolean;
};

/** Lifetime reps across every session — reps only, not hold-seconds: 1
 * second held is trivially easier to rack up than 1 rep, so blending the two
 * into one total let hold-heavy training blow through these thresholds far
 * faster than rep training ever could. Uses the ALL-attempts total
 * (`totalReps`), falling back to the best-single-attempt field for rows
 * saved before that column existed. */
function trainingPoints(sessions: SessionRecord[]): number {
  return sessions.reduce((sum, s) => sum + (s.totalReps ?? s.reps), 0);
}

/** Five tiers of the SAME ladder (same icon, same metric) — only the
 * threshold and badge color escalate — rather than five unrelated
 * achievement types, this is one progression read top to bottom. */
const LEVEL_ICON: keyof typeof Ionicons.glyphMap = 'barbell';

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'level_1',
    title: 'Getting Started',
    shortTitle: 'Level 1',
    description: 'Rack up 100 lifetime reps.',
    badge: 'lavender',
    icon: LEVEL_ICON,
    check: (ctx) => trainingPoints(ctx.sessions) >= 100,
  },
  {
    id: 'level_2',
    title: 'Building Momentum',
    shortTitle: 'Level 2',
    description: 'Rack up 1,000 lifetime reps.',
    badge: 'pink',
    icon: LEVEL_ICON,
    check: (ctx) => trainingPoints(ctx.sessions) >= 1000,
  },
  {
    id: 'level_3',
    title: 'In the Grind',
    shortTitle: 'Level 3',
    description: 'Rack up 5,000 lifetime reps.',
    badge: 'gold',
    icon: LEVEL_ICON,
    check: (ctx) => trainingPoints(ctx.sessions) >= 5000,
  },
  {
    id: 'level_4',
    title: 'Relentless',
    shortTitle: 'Level 4',
    description: 'Rack up 10,000 lifetime reps.',
    badge: 'blue',
    icon: LEVEL_ICON,
    check: (ctx) => trainingPoints(ctx.sessions) >= 10000,
  },
  {
    id: 'level_5',
    title: 'Legendary',
    shortTitle: 'Level 5',
    description: 'Rack up 25,000 lifetime reps.',
    badge: 'rainbow',
    icon: LEVEL_ICON,
    check: (ctx) => trainingPoints(ctx.sessions) >= 25000,
  },
];

export type AchievementStatus = Achievement & { unlocked: boolean };

/**
 * `ACHIEVEMENTS` is authored easiest-first. Unlocked badges are shown
 * hardest-first (the most impressive thing you've done leads), with the
 * still-locked ones after in their natural easiest-first progression order.
 */
export function computeAchievements(ctx: AchievementContext): AchievementStatus[] {
  const all = ACHIEVEMENTS.map((a) => ({ ...a, unlocked: a.check(ctx) }));
  const unlocked = all.filter((a) => a.unlocked).reverse();
  const locked = all.filter((a) => !a.unlocked);
  return [...unlocked, ...locked];
}
