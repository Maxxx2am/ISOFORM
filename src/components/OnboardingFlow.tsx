import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BodyStatsFields } from '@/components/BodyStatsFields';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { useProfile } from '@/store/profile';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const LAST_STEP = 3;

/**
 * First-run flow, shown exactly once (gated by `useOnboarding` in
 * _layout.tsx). Four screens: a welcome note, what this is, why the camera
 * is trustworthy, and an optional body-stats step.
 *
 * Deliberately no paywall step here — the first thing after onboarding
 * should read as "free to try," not "here's what you can't have." The
 * per-exercise lock screen (see search.tsx/exercise/[slug].tsx) is the only
 * paywall moment; someone can freely start a free exercise before ever
 * seeing a price.
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const profile = useProfile();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const goBack = useCallback(() => {
    if (step > 0) setStep((s) => (s - 1) as 0 | 1 | 2 | 3);
  }, [step]);

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} scroll={step === 3}>
      <View style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === step ? t.ink.primary : t.ink.hairline },
            ]}
          />
        ))}
      </View>

      {step === 0 ? (
        <View style={styles.body}>
          <View style={[styles.brandPreview, { backgroundColor: t.surface.raised, borderColor: t.ink.hairlineStrong }]}>
            <View style={[styles.previewTop, { borderBottomColor: t.ink.hairline }]}>
              <Text variant="label" tone="accent">ISOFORM</Text>
              <View style={[styles.previewLive, { backgroundColor: `${t.accent.color}18` }]}>
                <View style={[styles.previewDot, { backgroundColor: t.accent.color }]} />
                <Text variant="label" tone="accent">LIVE</Text>
              </View>
            </View>
            <View style={styles.previewBody}>
              <View style={[styles.previewPerson, { borderColor: `${t.accent.color}88` }]}>
                <View style={[styles.previewHead, { backgroundColor: t.accent.color }]} />
                <View style={[styles.previewLine, styles.previewShoulders, { backgroundColor: t.accent.color }]} />
                <View style={[styles.previewLine, styles.previewArm, { backgroundColor: t.accent.color }]} />
              </View>
              <View style={styles.previewMetric}>
                <Text variant="display" tone="accent">12</Text>
                <Text variant="label" tone="secondary">CLEAN REPS</Text>
              </View>
            </View>
          </View>
          <Text variant="hero" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            Train with{`\n`}better feedback.
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.md }}>
            ISOFORM counts clean reps and helps you build stronger movement patterns — right from your phone.
          </Text>
          <View style={styles.promiseList}>
            {[
              ['body-outline', 'Real-time rep counting'],
              ['analytics-outline', 'Form feedback you can act on'],
              ['shield-checkmark-outline', 'Processing stays on your phone'],
            ].map(([icon, label]) => (
              <View key={label} style={styles.promiseRow}>
                <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={t.accent.color} />
                <Text variant="body" style={{ flex: 1 }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : step === 1 ? (
        <View style={styles.body}>
          <View style={[styles.cameraPreview, { backgroundColor: t.surface.raised, borderColor: t.ink.hairlineStrong }]}>
            <View style={[styles.cameraFrame, { borderColor: `${t.accent.color}99` }]}>
              <View style={[styles.cameraCorner, styles.cornerTL, { borderColor: t.accent.color }]} />
              <View style={[styles.cameraCorner, styles.cornerTR, { borderColor: t.accent.color }]} />
              <View style={[styles.cameraCorner, styles.cornerBL, { borderColor: t.accent.color }]} />
              <View style={[styles.cameraCorner, styles.cornerBR, { borderColor: t.accent.color }]} />
              <Ionicons name="body-outline" size={72} color={t.accent.color} />
            </View>
            <View style={styles.cameraStatus}>
              <View style={[styles.previewDot, { backgroundColor: t.accent.color }]} />
              <Text variant="label" tone="accent">BODY IN FRAME</Text>
            </View>
          </View>
          <Text variant="hero" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            Your form coach.{'\n'}Right on your phone.
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.md }}>
            Real-time rep counting and form feedback for calisthenics — no gym, no equipment, no coach required.
          </Text>
        </View>
      ) : step === 2 ? (
        <View style={styles.body}>
          <View style={[styles.iconBadge, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Ionicons name="lock-closed" size={30} color={t.accent.color} />
          </View>
          <Text variant="hero" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            100% on your phone.
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.md }}>
            Every rep is tracked on-device. No account, no upload, nothing sent anywhere — your camera feed never leaves your phone.
          </Text>
          <Text tone="muted" variant="caption" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            You&apos;ll be asked for camera access next — that&apos;s what makes the tracking work.
          </Text>
        </View>
      ) : (
        <View style={styles.statsBody}>
          <View style={[styles.iconBadge, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline, alignSelf: 'center' }]}>
            <Ionicons name="stats-chart" size={28} color={t.accent.color} />
          </View>
          <Text variant="hero" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            One quick thing
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.md }}>
            Add your stats for a more accurate rank estimate in Insights — totally optional, skip anytime.
          </Text>

          <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
            <View style={styles.statsRow}>
              <Text variant="label" tone="muted">Units</Text>
              <Segmented<'metric' | 'imperial'>
                options={[
                  { label: 'Metric', value: 'metric' },
                  { label: 'Imperial', value: 'imperial' },
                ]}
                value={profile.units}
                onChange={profile.setUnits}
              />
            </View>
            <View style={styles.statsRow}>
              <Text variant="label" tone="muted">Sex</Text>
              <Segmented<'male' | 'female' | 'unspecified'>
                options={[
                  { label: 'Male', value: 'male' },
                  { label: 'Female', value: 'female' },
                  { label: 'Skip', value: 'unspecified' },
                ]}
                value={profile.sex}
                onChange={profile.setSex}
              />
            </View>
            <BodyStatsFields />
          </View>
        </View>
      )}

      {step > 0 ? (
        <Pressable onPress={goBack} hitSlop={8} style={{ position: 'absolute', top: Spacing.xl, left: Spacing.page }}>
          <Ionicons name="arrow-back" size={24} color={t.ink.secondary} />
        </Pressable>
      ) : null}

      <PrimaryButton
        label={step === LAST_STEP ? 'Start training' : 'Get started'}
        variant="hero"
        icon={<Ionicons name="arrow-forward" size={26} color={t.accent.onColor} />}
        onPress={() => (step === LAST_STEP ? onDone() : setStep((s) => (s + 1) as 0 | 1 | 2))}
        style={{ marginTop: Spacing.xl }}
      />
      {step === LAST_STEP ? (
        <Pressable onPress={onDone} hitSlop={8} style={{ marginTop: Spacing.md, alignSelf: 'center' }}>
          <Text tone="muted" variant="caption">Skip for now</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.lg },
  dot: { width: 6, height: 6, borderRadius: Radius.pill },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  statsBody: { paddingHorizontal: Spacing.md, paddingTop: Spacing.xl },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  promiseList: { alignSelf: 'stretch', marginTop: Spacing.xl, gap: Spacing.md },
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  brandPreview: { width: '100%', maxWidth: 360, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1 },
  previewLive: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.pill },
  previewDot: { width: 7, height: 7, borderRadius: Radius.pill },
  previewBody: { height: 190, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: Spacing.lg },
  previewPerson: { width: 110, height: 150, borderWidth: 1, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewHead: { width: 28, height: 28, borderRadius: Radius.pill },
  previewLine: { position: 'absolute', borderRadius: Radius.pill },
  previewShoulders: { width: 64, height: 8, top: 64 },
  previewArm: { width: 8, height: 58, top: 70, right: 24, transform: [{ rotate: '-24deg' }] },
  previewMetric: { alignItems: 'center' },
  cameraPreview: { width: '100%', maxWidth: 360, height: 230, borderRadius: Radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  cameraFrame: { width: 150, height: 165, borderWidth: 1, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cameraCorner: { position: 'absolute', width: 18, height: 18, borderWidth: 3 },
  cornerTL: { top: -2, left: -2, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: -2, right: -2, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: -2, left: -2, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: -2, right: -2, borderLeftWidth: 0, borderTopWidth: 0 },
  cameraStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
