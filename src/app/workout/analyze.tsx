import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Atmosphere } from '@/components/Atmosphere';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SessionEngine, type LiveState } from '@/engine/sessionEngine';
import { getExercise } from '@/exercises/data';
import { bestSessionFor } from '@/lib/insights';
import { makeId } from '@/lib/format';
import { AnalyzeVideoView, type AnalyzeVideoHandle } from '@/pose/AnalyzeVideoView';
import type { PoseFrame } from '@/pose/types';
import { useSessionStore } from '@/store/session';
import { listSessions, saveSession } from '@/storage/db';
import { schedulePushToCloud } from '@/lib/icloudSync';
import { persistVideoUri } from '@/lib/videoStorage';
import { Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function AnalyzeVideoScreen() {
  const { slug, uri, mime } = useLocalSearchParams<{ slug: string; uri: string; mime?: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const exercise = getExercise(slug);
  const setFinished = useSessionStore((s) => s.setFinished);

  const engine = useMemo(() => (exercise ? new SessionEngine(exercise) : null), [exercise]);
  const analyzeRef = useRef<AnalyzeVideoHandle>(null);
  const lastFrameTRef = useRef(0);
  const finalizedRef = useRef(false);
  const startedRef = useRef(false);

  const [status, setStatus] = useState('Preparing');
  const [progress, setProgress] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);

  const finalize = useCallback(async () => {
    if (finalizedRef.current || !engine || !exercise) return;
    finalizedRef.current = true;
    try {
      const id = makeId();
      const createdAt = Date.now();
      const summary = engine.summarize(lastFrameTRef.current);
      const aspect = dims && dims.w > 0 && dims.h > 0 ? dims.w / dims.h : undefined;
      const priorBest = bestSessionFor(exercise.id, await listSessions().catch(() => []));
      const previousBest = priorBest ? (priorBest.reps > 0 ? priorBest.reps : priorBest.holdSeconds) : null;
       const savedVideoUri = uri ? await persistVideoUri(uri, mime ?? 'video/mp4') : null;
       setFinished({
        id,
        exerciseName: exercise.name,
        createdAt,
        summary,
        timeline: engine.getTimeline(),
         videoUri: savedVideoUri,
        videoAspect: aspect,
        previousBest,
      });
       await saveSession(id, exercise.name, createdAt, summary, savedVideoUri, engine.getTimeline(), aspect).catch(() => {});
      schedulePushToCloud();
      router.replace({ pathname: '/workout/review/[id]', params: { id } });
    } catch {
      router.replace('/(tabs)');
    }
  }, [engine, exercise, setFinished, uri, mime, dims]);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      if (!engine) return;
      lastFrameTRef.current = frame.t;
      setLive(engine.push(frame));
    },
    [engine],
  );

  const onReady = useCallback(() => {
    if (startedRef.current || !uri) return;
    startedRef.current = true;
    analyzeRef.current?.loadAndAnalyze(uri, mime).catch((e: Error) => {
      Alert.alert('Couldn’t analyze this video', e.message || 'Try a shorter clip, or use the live camera instead.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    });
  }, [mime, uri]);

  const onError = useCallback((message: string) => {
    Alert.alert('Analysis error', message, [{ text: 'OK', onPress: () => router.back() }]);
  }, []);

  if (!exercise || !engine || !uri) {
    return (
      <Screen>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <Text tone="secondary" style={{ marginTop: Spacing.lg }}>Nothing to analyze.</Text>
      </Screen>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: t.surface.base, paddingTop: insets.top + Spacing.sm }]}
    >
      <Atmosphere />
      <View style={styles.headerRow}>
        <BackButton />
        <Text variant="heading">Analyzing {exercise.name}</Text>
      </View>

      <View style={styles.videoWrap}>
        <AnalyzeVideoView
          ref={analyzeRef}
          onFrame={onFrame}
          onStatus={setStatus}
          onReady={onReady}
          onError={onError}
          onProgress={(cur, duration) => setProgress(duration > 0 ? Math.min(1, cur / duration) : 0)}
          onDims={(w, h) => setDims({ w, h })}
          onDone={finalize}
          hideLegs={exercise.hideLegs}
          sideView={exercise.view === 'side'}
          showBar={exercise.showBar}
          mirror={false}
        />
      </View>

      <View style={styles.hud}>
        {live ? (
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {exercise.mode === 'hold' ? `${live.bestHoldSeconds}s best hold` : `${live.bestReps} reps`}
          </Text>
        ) : null}
        <Text tone="secondary" style={{ textAlign: 'center', marginTop: 2 }}>{status}</Text>
        <View style={[styles.progressTrack, { backgroundColor: t.surface.sunken }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: t.accent.color }]} />
        </View>
        <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: 4 }}>
          Keep this open until it finishes — closing early loses the analysis.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: Spacing.xl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.page },
  videoWrap: { flex: 1, marginTop: Spacing.md, overflow: 'hidden' },
  hud: { padding: Spacing.page, paddingBottom: Spacing.xl },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: Spacing.md },
  progressFill: { height: '100%' },
});
