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

/** The All Access offer, shared by every locked screen. Purchases are intentionally
 * not wired until the app is ready for submission. */
export function PlanRows({ exerciseName, lockedCount }: { exerciseName: string; lockedCount: number }) {
  const t = useTheme();
  return (
    <>
      <View style={styles.offerHeader}>
        <Text variant="label" tone="accent">ISOFORM ALL ACCESS</Text>
        <Text variant="hero" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
          Keep your momentum.
        </Text>
        <Text variant="caption" tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
          One plan for every movement, every progression, and every review.
        </Text>
      </View>
      <View
        style={[styles.benefits, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}
      >
        <Benefit icon="scan-outline" label="Live rep counting and form coaching" />
        <Benefit icon="videocam-outline" label="Import a clip for video review" />
        <Benefit icon="trending-up-outline" label="Every progression and future movement" />
      </View>
      <Pressable style={[styles.buyBtn, styles.buyBtnFeatured, { backgroundColor: Feedback.good, borderColor: Feedback.good }]}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" style={{ color: '#000' }}>
            All Access
          </Text>
          <Text variant="caption" style={{ color: 'rgba(0,0,0,0.6)' }}>
            {lockedCount > 0 ? `${lockedCount + 1} exercises` : 'All exercises'}
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

function Benefit({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.benefitRow}>
      <Ionicons name={icon} size={16} color={t.accent.color} />
      <Text variant="caption" tone="secondary" style={{ flex: 1 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  offerHeader: { alignItems: 'center', width: '100%', paddingHorizontal: Spacing.sm },
  benefits: { width: '100%', padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.sm },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
});
