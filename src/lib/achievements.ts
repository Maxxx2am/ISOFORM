/** Milestone achievements computed purely from local session history — no
 * new persisted state, just a check run over what's already logged. */
import { Ionicons } from '@expo/vector-icons';
import type { ImageSourcePropType } from 'react-native';

import type { ExerciseRank } from '@/lib/rank';
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
  totalReps: number;
  exercisesTrained: number;
  ranks: ExerciseRank[];
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

const DAY_MS = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Longest RUN of consecutive-day sessions ever, not just the current streak
 * (which resets the moment you miss a day) — a streak achievement should
 * stay earned even after the streak itself later breaks. */
function longestStreakDaysEver(sessions: SessionRecord[]): number {
  const days = [...new Set(sessions.map((s) => startOfDay(s.createdAt)))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of days) {
    run = prev != null && day - prev === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return longest;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_workout',
    title: 'First Set',
    shortTitle: 'First Set',
    description: 'Complete your very first tracked set.',
    badge: 'brown',
    icon: 'flag',
    check: (ctx) => ctx.sessions.length > 0,
  },
  {
    id: 'streak_7',
    title: 'Week Streak',
    shortTitle: '7-Day',
    description: 'Train 7 days in a row.',
    badge: 'steel',
    icon: 'flame-outline',
    check: (ctx) => longestStreakDaysEver(ctx.sessions) >= 7,
  },
  {
    id: 'streak_30',
    title: 'Month Streak',
    shortTitle: '30-Day',
    description: 'Train 30 days in a row.',
    badge: 'copper',
    icon: 'flame',
    check: (ctx) => longestStreakDaysEver(ctx.sessions) >= 30,
  },
  {
    id: 'reps_100',
    title: 'Century',
    shortTitle: '100',
    description: 'Rack up 100 lifetime reps.',
    badge: 'lavender',
    icon: 'barbell-outline',
    check: (ctx) => ctx.totalReps >= 100,
  },
  {
    id: 'well_rounded',
    title: 'Well-Rounded',
    shortTitle: 'Versatile',
    description: 'Reach Silver or higher in 5 different exercises.',
    badge: 'pink',
    icon: 'shapes',
    check: (ctx) => ctx.ranks.filter((r) => r.tierIndex >= 4).length >= 5,
  },
  {
    id: 'gold_rank',
    title: 'Going for Gold',
    shortTitle: 'Gold IV',
    description: 'Reach Gold IV — the very top tier — in any exercise.',
    badge: 'gold',
    icon: 'medal',
    check: (ctx) => ctx.ranks.some((r) => r.tier === 'Gold IV'),
  },
  {
    id: 'reps_1000',
    title: 'Grand',
    shortTitle: '1,000',
    description: 'Rack up 1,000 lifetime reps.',
    badge: 'blue',
    icon: 'barbell',
    check: (ctx) => ctx.totalReps >= 1000,
  },
  {
    id: 'reps_10000',
    title: 'Ten Thousand',
    shortTitle: '10,000',
    description: 'Rack up 10,000 lifetime reps.',
    badge: 'rainbow',
    icon: 'trophy',
    check: (ctx) => ctx.totalReps >= 10000,
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
