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
          <View style={[styles.iconBadge, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Ionicons name="heart" size={30} color={t.accent.color} />
          </View>
          <Text variant="heading" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            Welcome to ISOFORM
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.md }}>
            Hey &mdash; I&apos;m a solo dev who built this app. Every feature, every bug fix, every late-night deploy is just me, trying to make something genuinely useful.
          </Text>
          <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.sm }}>
            If anything doesn&apos;t work right or could be better, please reach out and let me know before leaving a bad review &mdash; I&apos;ll do my best to fix it.
          </Text>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.lg }}>
            Thanks for installing. Hope you have some great training sessions.
          </Text>
        </View>
      ) : step === 1 ? (
        <View style={styles.body}>
          <View style={[styles.iconBadge, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Ionicons name="body" size={32} color={t.accent.color} />
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
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
