import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { computeStreakDays } from '@/lib/insights';
import { listSessions } from '@/storage/db';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/**
 * The one personalized hook on an otherwise generic paywall — a REAL streak
 * the person already has (same number Train/Insights already show via
 * StreakFlame), not an invented sales pitch. Only fetched while a locked
 * screen is actually visible, and only ever shown for a genuine streak (2+
 * days) — same "no data, no nudge" rule the Train tab's "Up next" card
 * already follows elsewhere in the app.
 */
function useStreakHook(active: boolean): number {
  const [days, setDays] = useState(0);
  useEffect(() => {
    if (!active) return;
    listSessions()
      .then((rows) => setDays(computeStreakDays(rows.map((r) => r.createdAt))))
      .catch(() => {});
  }, [active]);
  return days;
}

export function StreakHook({ active }: { active: boolean }) {
  const days = useStreakHook(active);
  if (days < 2) return null;
  return (
    <View style={[styles.hookRow, { backgroundColor: `${Feedback.warn}1A`, borderColor: Feedback.warn }]}>
      <Ionicons name="flame" size={16} color={Feedback.warn} />
      <Text variant="caption" style={{ flex: 1, color: Feedback.warn }}>
        {days}-day streak going — All Access keeps every exercise in it, not just this one.
      </Text>
    </View>
  );
}

/** Small rounded chip instead of bare corner text — enough to read as an
 * actual badge without turning into its own competing design element. */
function BestValueTag() {
  return (
    <View style={styles.featuredTag}>
      <Ionicons name="star" size={9} color="rgba(0,0,0,0.68)" />
      <Text variant="label" style={styles.featuredTagText}>
        Best value
      </Text>
    </View>
  );
}

/** The two paywall plan rows, shared by every locked screen in the app so a
 * copy/pricing change never has to happen in more than one place. */
export function PlanRows({ exerciseName, lockedCount }: { exerciseName: string; lockedCount: number }) {
  const t = useTheme();
  return (
    <>
      <Pressable style={[styles.buyBtn, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{exerciseName}</Text>
          <Text variant="caption" tone="secondary">
            Just this exercise
          </Text>
        </View>
        <Text variant="heading" tone="accent">
          $1/mo
        </Text>
      </Pressable>

      {/* The free trial is All Access only — said once, right on its price,
          not as a blanket banner that would (wrongly) read as covering the
          $1 row too. */}
      <Pressable style={[styles.buyBtn, styles.buyBtnFeatured, { backgroundColor: Feedback.good, borderColor: Feedback.good }]}>
        <BestValueTag />
        <View style={{ flex: 1 }}>
          <Text variant="heading" style={{ color: '#000' }}>
            All Access
          </Text>
          <Text variant="caption" style={{ color: 'rgba(0,0,0,0.6)' }}>
            {lockedCount > 0 ? `Unlocks all ${lockedCount + 1}, plus every future one` : 'Every exercise, future updates'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="heading" style={{ color: '#000' }}>
            $5/mo
          </Text>
          <Text variant="caption" style={{ color: 'rgba(0,0,0,0.6)' }}>
            7 days free
          </Text>
        </View>
      </Pressable>

      <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
        Subscriptions aren&apos;t live yet — check back soon.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  hookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    width: '100%',
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  buyBtnFeatured: { position: 'relative', paddingTop: Spacing.md + 10 },
  featuredTag: {
    position: 'absolute',
    top: 6,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  featuredTagText: {
    color: 'rgba(0,0,0,0.7)',
    letterSpacing: 0.6,
  },
});
