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

      <Text tone="secondary" style={{ marginTop: Spacing.lg }}>Last updated: [date]</Text>

      <Section title="Not a medical device">
        ISOFORM estimates your body position from camera video and gives coaching feedback based on
        that estimate. It is a training aid, not a medical, diagnostic, or physical-therapy device. Pose
        estimation can be wrong — always listen to your own body over the app, and stop any exercise
        that causes pain.
      </Section>

      <Section title="Train at your own risk">
        Calisthenics and bodyweight training carry a real risk of injury, especially advanced moves
        (handstands, levers, planche work). Only attempt exercises appropriate to your current strength
        and mobility, warm up properly, and consult a medical professional before starting a new
        exercise program if you have any relevant health condition.
      </Section>

      <Section title="Your content">
        Videos you record are stored on your device (or your Photos library, if you save them) and are
        never uploaded by the app. You&apos;re responsible for whatever you choose to do with a saved video
        afterward.
      </Section>

      <Section title="Subscriptions">
        Optional paid unlocks, when available, will be billed through the App Store under Apple&apos;s
        standard subscription terms and can be managed or cancelled from your device&apos;s App Store
        account settings.
      </Section>

      <Section title="No warranty">
        The app is provided &quot;as is.&quot; We don&apos;t guarantee the accuracy of rep counts, form scores, or
        coaching feedback, and we&apos;re not liable for injuries, missed workouts, or other outcomes from
        using it.
      </Section>

      <Section title="Changes">
        These terms may be updated as the app changes; continued use after an update means you accept
        the revised terms.
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
