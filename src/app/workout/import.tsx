import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getExercise } from '@/exercises/data';
import { makeId } from '@/lib/format';
import { schedulePushToCloud } from '@/lib/icloudSync';
import { uploadSessionTelemetry } from '@/lib/telemetry';
import { processImportedVideo, type ImportProgress } from '@/lib/videoImport';
import { saveSession } from '@/storage/db';
import { Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function VideoImportScreen() {
  const t = useTheme();
  const { slug, videoUri } = useLocalSearchParams<{ slug: string; videoUri: string }>();
  const exercise = getExercise(slug);
  const [phase, setPhase] = useState<'start' | 'processing' | 'done' | 'error'>('start');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState('');
  const resultRef = useRef<Awaited<ReturnType<typeof processImportedVideo>> | null>(null);

  useEffect(() => {
    if (phase !== 'start' || !exercise || !videoUri) return;
    setPhase('processing');
    processImportedVideo(videoUri, exercise, (p) => setProgress(p))
      .then((res) => {
        resultRef.current = res;
        setPhase('done');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Processing failed');
        setPhase('error');
      });
  }, [phase, exercise, videoUri]);

  const saveAndReview = async () => {
    const res = resultRef.current;
    if (!res || !exercise) return;
    const id = makeId(Date.now());
    await saveSession(id, exercise.name, Date.now(), res.summary, videoUri, res.timeline, undefined);
    schedulePushToCloud();
    uploadSessionTelemetry(id, exercise.name, Date.now(), res.summary, videoUri, res.timeline);
    router.replace({ pathname: '/workout/review/[id]', params: { id } });
  };

  if (!exercise || !videoUri) {
    return (
      <Screen>
        <Text>Missing exercise or video.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.center}>
        {phase === 'processing' ? (
          <>
            <ActivityIndicator size="large" color={t.accent.color} />
            <Text variant="heading" style={{ marginTop: Spacing.lg }}>
              Processing video
            </Text>
            <Text tone="secondary" style={{ marginTop: Spacing.xs }}>
              {progress?.phase === 'extracting' ? 'Extracting frames…' : 'Tracking body…'}
            </Text>
            {progress ? (
              <Text tone="muted" style={{ marginTop: Spacing.xs }}>
                Frame {progress.frame} of up to {progress.total}
              </Text>
            ) : null}
          </>
        ) : phase === 'done' ? (
          <>
            <Ionicons name="checkmark-circle" size={48} color={t.accent.color} />
            <Text variant="heading" style={{ marginTop: Spacing.lg }}>
              Done
            </Text>
            <Text tone="secondary" style={{ marginTop: Spacing.xs, textAlign: 'center' }}>
              {resultRef.current?.summary.reps ?? 0} reps · {resultRef.current?.summary.cues.length ?? 0} cues found
            </Text>
            <PrimaryButton
              label="View results"
              icon={<Ionicons name="play" size={20} color={t.accent.onColor} />}
              onPress={saveAndReview}
              variant="hero"
              style={{ marginTop: Spacing.xl, width: 200 }}
            />
          </>
        ) : phase === 'error' ? (
          <>
            <Ionicons name="alert-circle" size={48} color={t.ink.muted} />
            <Text variant="heading" style={{ marginTop: Spacing.lg }}>
              Failed
            </Text>
            <Text tone="secondary" style={{ marginTop: Spacing.xs, textAlign: 'center' }}>
              {error || 'Could not process this video.'}
            </Text>
            <PrimaryButton
              label="Go back"
              onPress={() => router.back()}
              style={{ marginTop: Spacing.xl }}
            />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
