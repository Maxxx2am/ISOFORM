import { Stack } from 'expo-router';
import { View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Spacing } from '@/theme/palette';

/**
 * Draft terms of use. Replace the bracketed placeholders (company/developer
 * name, governing-law jurisdiction, support email) before submitting to App
 * Store review — Apple requires either these or the standard Apple EULA to be
 * linked from the app listing.
 */
export default function TermsScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <BackButton />
        <Text variant="title">Terms of Use</Text>
      </View>

      <Text tone="secondary" style={{ marginTop: Spacing.lg }}>Last updated: July 31, 2026</Text>

      <Section title="Not a medical device">
        ISOFORM uses on-device pose estimation to count reps and provide real-time form feedback during
        bodyweight workouts. It is a training aid, not a medical, diagnostic, or physical-therapy device.
        Pose estimation can be inaccurate — always listen to your body over the app, and stop any
        exercise that causes pain or discomfort.
      </Section>

      <Section title="Train at your own risk">
        Calisthenics and bodyweight training carry inherent risk of injury, especially advanced movements
        (handstands, levers, planche, muscle-ups). Only attempt exercises appropriate to your current
        strength and mobility. Warm up properly. Consult a medical professional before starting a new
        exercise program if you have any pre-existing condition, are pregnant, or are recovering from
        injury. ISOFORM is not responsible for injuries sustained while using the app.
      </Section>

      <Section title="Your content">
        Videos you record during a workout are stored locally on your device (or in your Photos library
        if you choose to save them). They are never uploaded, shared, or transmitted by the app. You are
        solely responsible for anything you do with a saved video afterward.
      </Section>

      <Section title="Content updates">
        ISOFORM periodically checks for updated exercise configurations from a public GitHub repository
        to keep rep-counting thresholds and exercise data current. This check does not transmit any
        personal information — it only downloads a small JSON file. The app functions fully offline and
        uses locally cached data when no connection is available.
      </Section>

      <Section title="Subscriptions & purchases">
        Certain exercises and features may require an in-app purchase or subscription, billed through
        Apple&apos;s App Store under Apple&apos;s standard subscription terms. All payments are processed by Apple,
        not by us. Subscriptions auto-renew unless cancelled at least 24 hours before the current period
        ends. Manage or cancel from your device&apos;s App Store account settings. Prices and availability are
        subject to change.
      </Section>

      <Section title="No warranty">
        The app is provided &quot;as is&quot; without warranty of any kind. Rep counts, form scores, and coaching
        cues are estimates based on camera input and may be inaccurate due to lighting, camera angle,
        clothing, or other factors. We do not guarantee the accuracy of any measurement and are not liable
        for injuries, tracking errors, or any other outcomes from using the app.
      </Section>

      <Section title="Offline use">
        ISOFORM is designed to work without an internet connection. Pose tracking, rep counting, and
        session storage all run locally on your device. Only optional content updates require network
        access.
      </Section>

      <Section title="Changes">
        These terms may be updated as the app evolves. Continued use after an update constitutes
        acceptance of the revised terms. The &quot;last updated&quot; date at the top of this page reflects
        the most recent revision.
      </Section>

      <Section title="Contact">
        Questions about these terms: reach out on TikTok @maxxxdev.
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: Spacing.lg, gap: Spacing.xs }}>
      <Text variant="heading">{title}</Text>
      <Text variant="body" tone="secondary">{children}</Text>
    </View>
  );
}
