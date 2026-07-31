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

      <Text tone="secondary" style={{ marginTop: Spacing.lg }}>Last updated: July 31, 2026</Text>

      <Section title="On-device by default">
        ISOFORM&apos;s pose tracking, rep counting, form analysis, and skeleton overlay all run entirely on
        your phone. Your camera feed is never uploaded, streamed, or transmitted off-device. Landmark
        coordinates are computed locally frame-by-frame in a WebView and discarded as the session
        progresses.
      </Section>

      <Section title="No account. No sign-in.">
        There is no account system. ISOFORM does not ask for your name, email, phone number, or any
        other personally identifiable information. Nothing you do in the app is tied to an identity.
      </Section>

      <Section title="What is stored, and where">
        Workout history (exercise name, rep count or hold time, date, duration, form score, and coaching
        cues) is saved in a local SQLite database on your device only. Workout videos you choose to save
        go to your device&apos;s Photos library or app storage. Nothing is stored on any server we control or
        have access to. Deleting the app removes all locally stored data.
      </Section>

      <Section title="Network requests (two limited cases)">
        <Text variant="body" tone="secondary">
          ISOFORM makes network requests in exactly two situations, neither of which transmits any personal or workout data:
        </Text>
        {'\n\n'}
        <Text variant="body" tone="secondary">
          <Text style={{ fontWeight: '700' }}>1. Pose detection model (first use only).{' '}</Text>
          The first time you start a pose-tracked workout, the app downloads Google&apos;s MediaPipe pose
          landmarker model and its WebAssembly runtime from two CDNs: jsdelivr (cdn.jsdelivr.net) and
          Google Cloud Storage (storage.googleapis.com). This download is approximately 4 MB, happens
          once, and is cached locally thereafter — subsequent workouts work fully offline. The download
          request only reveals standard network metadata (IP address, user agent) — it does not include
          any camera feed, video, or workout data.
        </Text>
        {'\n\n'}
        <Text variant="body" tone="secondary">
          <Text style={{ fontWeight: '700' }}>2. Exercise config updates (on launch and manual refresh).{' '}</Text>
          ISOFORM checks a public GitHub repository (raw.githubusercontent.com) for updated exercise
          thresholds and a changelog. This is a simple JSON download — it does not send any data to
          GitHub. When offline, the app uses its built-in exercise defaults and the last cached config.
        </Text>
      </Section>

      <Section title="Camera & microphone">
        Camera access is used only during an active workout to track your body position. The camera feed
        runs locally through on-device pose detection and is never transmitted. If you enable video
        saving, the recorded video includes its original audio track — also stored locally only. You can
        deny camera access and the app will still function for browsing exercises and reviewing past
        sessions.
      </Section>

      <Section title="Third-party services">
        ISOFORM does not integrate any analytics, advertising, or tracking SDKs. No third party receives
        usage data, workout data, or personal information through this app. The only third-party network
        requests are the two described above (MediaPipe model + exercise config), which are strictly
        download-only.
      </Section>

      <Section title="Deleting your data">
        Delete all locally stored workout history at any time from Settings → Backup & Data → Delete all
        data. Workout videos saved to your Photos library must be deleted from the Photos app directly.
        Uninstalling ISOFORM removes the SQLite database and all app-internal storage.
      </Section>

      <Section title="Children">
        ISOFORM is not directed at children under 13 and does not knowingly collect personal information
        from anyone, regardless of age — it does not collect personal information from any user.
      </Section>

      <Section title="Changes to this policy">
        If how the app stores or transmits data changes, this page will be updated and the &quot;last
        updated&quot; date above will reflect the change.
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
