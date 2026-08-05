import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Atmosphere } from '@/components/Atmosphere';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useExerciseRegistry } from '@/exercises/registry';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Changelog for remotely-updated exercise content (see src/exercises/registry.ts) —
 * bug fixes and new exercises the developer pushed without an app update. */
export default function WhatsNewScreen() {
  const t = useTheme();
  const changelog = useExerciseRegistry((s) => s.changelog);
  const remoteVersion = useExerciseRegistry((s) => s.remoteVersion);
  const refreshing = useExerciseRegistry((s) => s.refreshing);
  const markChangelogSeen = useExerciseRegistry((s) => s.markChangelogSeen);

  useEffect(() => {
    markChangelogSeen();
  }, [markChangelogSeen]);

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: false }} />
      <Atmosphere />
      <View style={{ paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
        <BackButton />
        <Text variant="title">What&apos;s New</Text>
      </View>

      {refreshing ? (
        <View style={{ marginTop: Spacing.xl, alignItems: 'center' }}>
          <ActivityIndicator color={t.ink.primary} />
        </View>
      ) : changelog.length === 0 ? (
        <View style={{ marginTop: Spacing.xl, alignItems: 'center', gap: Spacing.xs }}>
          <Text tone="secondary" style={{ textAlign: 'center' }}>
            {remoteVersion > 0
              ? 'No changes yet.'
              : "Nothing to show — either you're offline, or updates haven't been set up yet."}
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          {changelog
            .slice()
            .sort((a, b) => b.version - a.version)
            .map((entry) => (
              <View
                key={`${entry.version}-${entry.title}`}
                style={{
                  padding: Spacing.lg,
                  borderRadius: Radius.lg,
                  borderWidth: 1,
                  borderColor: t.ink.hairline,
                  backgroundColor: t.surface.raised,
                  gap: 4,
                }}
              >
                <Text variant="caption" tone="muted">
                  {entry.date}
                </Text>
                <Text variant="heading">{entry.title}</Text>
                <Text variant="body" tone="secondary">
                  {entry.body}
                </Text>
              </View>
            ))}
        </View>
      )}
    </Screen>
  );
}
