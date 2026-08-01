import { Stack } from 'expo-router';
import { View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Spacing } from '@/theme/palette';

/**
 * Draft privacy policy — reflects exactly what the app does today. Replace the
 * bracketed placeholders (contact email, company/developer name) before
 * submitting to App Store review, and host an identical copy at a public URL
 * for the App Store Connect "Privacy Policy URL" field.
 */
export default function PrivacyScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <BackButton />
        <Text variant="title">Privacy Policy</Text>
      </View>

      <Text tone="secondary" style={{ marginTop: Spacing.lg }}>Last updated: [date]</Text>

      <Section title="On-device by default">
        ISOFORM&apos;s pose tracking, rep counting, and form analysis all run locally on your phone. Your
        camera feed is never uploaded anywhere — landmarks are computed on-device, frame by frame, and
        thrown away as you go.
      </Section>

      <Section title="What's stored, and where">
        Workout history (exercise, reps or hold time, date, and a form score) is saved in a local
        database on your device only. Any video you choose to save is written to your device&apos;s Photos
        library or app storage, never to a server we control. Nothing is tied to an account, because
        there is no account — the app doesn&apos;t require sign-in.
      </Section>

      <Section title="One exception: loading the pose model">
        The first time the app needs the on-device pose model, it downloads it once from a
        third-party CDN (jsdelivr, serving Google&apos;s MediaPipe libraries) over the internet. That
        request can see your IP address and general network metadata, the same as loading any website
        — it does not receive your camera feed, video, or workout data.
      </Section>

      <Section title="Camera & microphone">
        Camera access is used only to track your body during a workout. Microphone/audio recording
        (if you save a video) captures the video&apos;s audio track locally. Neither is transmitted off
        your device by this app.
      </Section>

      <Section title="Deleting your data">
        You can delete all locally stored workout history at any time from Settings → Backup & Data →
        Delete all data. Uninstalling the app removes everything else the app stored on your device.
      </Section>

      <Section title="Children">
        This app is not directed at children under 13 and does not knowingly collect information from
        them (it does not collect personal information from anyone, on- or off-device).
      </Section>

      <Section title="Changes to this policy">
        If what the app stores or how it works changes, this page will be updated and the &quot;last
        updated&quot; date above will change accordingly.
      </Section>

      <Section title="Contact">
        Questions about this policy: reach out on TikTok @maxxxdev.
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
