import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { Confetti } from '@/components/Confetti';
import { PrimaryButton } from '@/components/PrimaryButton';
import { QualityGauge } from '@/components/QualityGauge';
import { RepGauge } from '@/components/RepGauge';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import type { CueTally } from '@/engine/formAnalyzer';
import { scoreSession, type SessionSummary, type TimelineSample } from '@/engine/sessionEngine';
import { getExercise, getNextProgression, getPrevProgression } from '@/exercises/data';
import { coachNotes } from '@/lib/coach';
import { formatClock } from '@/lib/format';
import { SkeletonOverlay } from '@/pose/SkeletonOverlay';
import { useSessionStore } from '@/store/session';
import { getSession } from '@/storage/db';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const PAD_MS = 3000;

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const finished = useSessionStore((s) => s.finished);
  const clear = useSessionStore((s) => s.clear);

  const fromStore = finished?.id === id ? finished : null;
  const [summary, setSummary] = useState<SessionSummary | null>(fromStore?.summary ?? null);
  const [exerciseName, setExerciseName] = useState(fromStore?.exerciseName ?? '');
  const [videoUri, setVideoUri] = useState<string | null>(fromStore?.videoUri ?? null);
  const [timeline, setTimeline] = useState<TimelineSample[] | null>(fromStore?.timeline ?? null);
  // The DB doesn't have every sub-score a fresh in-memory summary does (depth/
  // consistency/form quality breakdowns), so for a reopened history session we
  // show the score computed and saved at the time — not a recompute from a
  // partial reconstruction, which used to silently produce the wrong number.
  const [historyScore, setHistoryScore] = useState<number | null>(null);
  const [videoAspect, setVideoAspect] = useState<number | undefined>(fromStore?.videoAspect);

  // A "new record" only ever fires for a FRESH finish — previousBest lives
  // only on the in-memory handoff, never persisted/reconstructed for a
  // reopened history session, so revisiting an old set can't re-trigger it.
  const previousBest = fromStore ? fromStore.previousBest : null;
  const currentValue = summary ? (summary.mode === 'hold' ? summary.holdSeconds : summary.reps) : 0;
  const isNewRecord = previousBest != null && currentValue > previousBest;
  const [showConfetti, setShowConfetti] = useState(false);
  useEffect(() => {
    if (isNewRecord) setShowConfetti(true);
  }, [isNewRecord]);

  useEffect(() => {
    if (fromStore) return;
    getSession(id).then((rec) => {
      if (!rec) return;
      setExerciseName(rec.exerciseName);
      setVideoUri(rec.videoUri);
      setVideoAspect(rec.videoAspect ?? undefined);
      setTimeline(rec.timeline.length > 0 ? rec.timeline : null);
      setHistoryScore(rec.score);
      const ex = getExercise(rec.exerciseId);
      const target = ex?.targetAngle ?? null;
      let depthScore: number | null = null;
      if (rec.avgBottomAngle != null && target != null) {
        const err = Math.abs(rec.avgBottomAngle - target);
        depthScore = Math.max(0, Math.round(100 - err * 1.5));
      }
      setSummary({
        exerciseId: rec.exerciseId,
        mode: rec.reps > 0 ? 'reps' : 'hold',
        durationMs: rec.durationMs,
        reps: rec.reps,
        holdSeconds: rec.holdSeconds,
        attempts: 1,
        avgBottomAngle: rec.avgBottomAngle,
        targetAngle: target,
        depthScore,
        consistencyScore: null,
        avgRepSeconds: null,
        romDegrees: null,
        formQuality: null,
        cues: rec.cues,
        firstActionMs: rec.firstActionMs,
        lastActionMs: rec.lastActionMs,
      });
    });
  }, [id, fromStore]);

  const window = useMemo(() => computeWindow(summary, timeline), [summary, timeline]);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const saveVideo = useCallback(async () => {
    if (!videoUri || saveState === 'saving') return;
    setSaveState('saving');
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) throw new Error('Media library permission denied');
      await MediaLibrary.saveToLibraryAsync(videoUri);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [videoUri, saveState]);

  return (
    <>
      <Screen scroll>
      <View style={styles.header}>
        <BackButton
          onPress={() => {
            clear();
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)');
          }}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="muted">
            Set Review
          </Text>
          <Text variant="title">{exerciseName || 'Workout'}</Text>
        </View>
      </View>

      <ReplayStage
        videoUri={videoUri}
        timeline={timeline}
        window={window}
        aspect={videoAspect}
        exerciseId={summary?.exerciseId ?? null}
        showSkeleton={showSkeleton}
        hideLegs={!!(summary && getExercise(summary.exerciseId)?.hideLegs)}
        sideView={!!(summary && getExercise(summary.exerciseId)?.view === 'side')}
        showBar={!!(summary && getExercise(summary.exerciseId)?.showBar)}
        action={
          summary
            ? { first: summary.firstActionMs, last: summary.lastActionMs, mode: summary.mode }
            : undefined
        }
      />

      {videoUri ? (
        <View style={styles.replayControls}>
          <ControlPill
            icon="body-outline"
            label={showSkeleton ? 'Skeleton on' : 'Skeleton off'}
            active={showSkeleton}
            onPress={() => setShowSkeleton((v) => !v)}
          />
          <ControlPill
            icon={saveState === 'saved' ? 'checkmark' : 'download-outline'}
            label={
              saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved to Photos'
                  : saveState === 'failed'
                    ? 'Couldn\u2019t save'
                    : 'Save video'
            }
            onPress={saveVideo}
          />
        </View>
      ) : null}

      {summary ? (
        <Report summary={summary} scoreOverride={historyScore} isNewRecord={isNewRecord} previousBest={previousBest} />
      ) : (
        <Text tone="muted">Loading…</Text>
      )}
      {summary ? <ProgressionAdvice summary={summary} /> : null}

      <PrimaryButton
        label="Done"
        style={{ marginTop: Spacing.lg }}
        onPress={() => {
          clear();
          router.dismissAll?.();
          router.replace('/(tabs)');
        }}
      />
    </Screen>
    {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
    </>
  );
}

function computeWindow(summary: SessionSummary | null, timeline: TimelineSample[] | null) {
  const tlStart = timeline?.[0]?.t ?? 0;
  const tlEnd = timeline?.[timeline.length - 1]?.t ?? summary?.durationMs ?? 0;
  const first = summary?.firstActionMs ?? tlStart;
  const last = summary?.lastActionMs ?? tlEnd;
  return { startMs: Math.max(0, first - PAD_MS), endMs: Math.min(tlEnd || last + PAD_MS, last + PAD_MS) };
}

type ActionWindow = { first: number | null; last: number | null; mode: 'reps' | 'hold' };

function ReplayStage({
  videoUri,
  timeline,
  window,
  aspect,
  exerciseId,
  action,
  showSkeleton = true,
  hideLegs = false,
  sideView = false,
  showBar = false,
}: {
  videoUri: string | null;
  timeline: TimelineSample[] | null;
  window: { startMs: number; endMs: number };
  aspect?: number;
  exerciseId: string | null;
  action?: ActionWindow;
  showSkeleton?: boolean;
  hideLegs?: boolean;
  sideView?: boolean;
  showBar?: boolean;
}) {
  if (videoUri)
    return (
      <VideoReplay
        uri={videoUri}
        timeline={timeline}
        window={window}
        aspect={aspect}
        exerciseId={exerciseId}
        action={action}
        showSkeleton={showSkeleton}
        hideLegs={hideLegs}
        sideView={sideView}
        showBar={showBar}
      />
    );
  if (timeline && timeline.length > 0)
    return <SkeletonReplay timeline={timeline} window={window} exerciseId={exerciseId} hideLegs={hideLegs} sideView={sideView} showBar={showBar} />;
  return null;
}

function ControlPill({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlPill,
        {
          backgroundColor: active ? t.ink.primary : t.surface.raised,
          borderColor: t.ink.hairline,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? t.surface.base : t.ink.secondary} />
      <Text variant="caption" style={{ color: active ? t.surface.base : t.ink.secondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "Starts in 2.1s" → "Tracking · 12s" → "Finished" badge over the replay. */
function ActionBadge({ tMs, action }: { tMs: number; action?: ActionWindow }) {
  const t = useTheme();
  if (!action || action.first == null) return null;
  let text: string;
  let bg = 'rgba(0,0,0,0.55)';
  if (tMs < action.first) {
    text = `Starts in ${Math.max(0, (action.first - tMs) / 1000).toFixed(1)}s`;
  } else if (action.last != null && tMs <= action.last + 250) {
    text =
      action.mode === 'hold'
        ? `Tracking · ${Math.floor((tMs - action.first) / 1000)}s`
        : 'Tracking';
    bg = t.accent.color;
  } else {
    text = 'Finished';
  }
  const onAccent = bg === t.accent.color;
  return (
    <View style={[styles.actionBadge, { backgroundColor: bg }]}>
      <View style={[styles.recDot, { backgroundColor: onAccent ? t.accent.onColor : '#FF453A' }]} />
      <Text variant="caption" style={{ color: onAccent ? t.accent.onColor : '#FFFFFF' }}>
        {text}
      </Text>
    </View>
  );
}

/** Real recorded video, looped within the trimmed window, with the skeleton synced on top. */
function VideoReplay({
  uri,
  timeline,
  window,
  aspect,
  exerciseId,
  action,
  showSkeleton = true,
  hideLegs = false,
  sideView = false,
  showBar = false,
}: {
  uri: string;
  timeline: TimelineSample[] | null;
  window: { startMs: number; endMs: number };
  aspect?: number;
  exerciseId: string | null;
  action?: ActionWindow;
  showSkeleton?: boolean;
  hideLegs?: boolean;
  sideView?: boolean;
  showBar?: boolean;
}) {
  const t = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tMs, setTMs] = useState(0);
  const [sample, setSample] = useState<TimelineSample | null>(timeline?.[0] ?? null);

  const ex = exerciseId ? getExercise(exerciseId) : null;
  const gauge = ex?.gauge ?? null;
  const anglesFn = ex?.angles ?? null;
  const [gaugeMarker, setGaugeMarker] = useState(0);

  const player = useVideoPlayer(uri, (p) => {
    // Native loop as a safety net alongside the trimmed-window re-seek below:
    // if the computed trim window is ever slightly off, this guarantees the
    // clip restarts instead of just freezing on the final frame.
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    const startSec = window.startMs / 1000;
    const endSec = Math.max(startSec + 1, window.endMs / 1000);
    const seekStart = () => {
      try {
        player.currentTime = startSec;
      } catch {}
    };
    seekStart();
    player.play();
    const iv = setInterval(() => {
      let ct = 0;
      try {
        ct = player.currentTime ?? 0;
      } catch {}
      if (ct >= endSec || ct < startSec - 0.15) {
        seekStart();
        ct = startSec;
      }
      setTMs(ct * 1000);
      if (timeline) {
        const s = nearestSample(timeline, ct * 1000);
        setSample(s);
        // Compute gauge marker from nearest sample's landmarks
        if (gauge && anglesFn && s) {
          const a = anglesFn(s.landmarks)[gauge.angle];
          if (a != null) setGaugeMarker(Math.min(1, Math.max(0, a / 180)));
        }
      }
    }, 66);
    return () => clearInterval(iv);
  }, [player, window.startMs, window.endMs, timeline, gauge, anglesFn]);

  const H = 400;
  const boxStyle = aspect && aspect > 0 ? { width: Math.round(H * aspect), height: H } : { width: '100%' as const, height: H };
  const gaugeVis = gauge && anglesFn && sample != null;

  return (
    <View style={styles.stageOuter}>
      <View
        style={[styles.videoBox, boxStyle]}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, styles.mirror]}
          contentFit="contain"
          nativeControls={false}
        />
        {/* Overlays live in their own stacking layer so the native video can't
            paint over the skeleton + timer. */}
        <View style={styles.overlayLayer} pointerEvents="none">
          {showSkeleton && size.w > 0 && sample ? (
            <SkeletonOverlay landmarks={sample.landmarks} width={size.w} height={size.h} mirror accentColor={t.accent.color} hideLegs={hideLegs} sideView={sideView} showBar={showBar} />
          ) : null}
          <ActionBadge tMs={tMs} action={action} />
          {sample?.activeCue ? <CueTag text={sample.activeCue} /> : null}
        </View>
        {gaugeVis ? (
          <View style={styles.replayGaugeWrap}>
            {ex?.mode === 'hold' ? (
              <QualityGauge marker={gaugeMarker} target={gauge.target / 180} visible style={styles.replayGaugeInner} />
            ) : (
              <RepGauge marker={gaugeMarker} down={gauge.downBelow / 180} up={gauge.upAbove / 180} visible style={styles.replayGaugeInner} />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Fallback: animated skeleton within the trimmed window. */
function SkeletonReplay({ timeline, window, hideLegs = false, sideView = false, showBar = false }: { timeline: TimelineSample[]; window: { startMs: number; endMs: number }; exerciseId?: string | null; hideLegs?: boolean; sideView?: boolean; showBar?: boolean }) {
  const t = useTheme();
  const clip = useMemo(
    () => timeline.filter((s) => s.t >= window.startMs && s.t <= window.endMs),
    [timeline, window.startMs, window.endMs],
  );
  const frames = clip.length > 0 ? clip : timeline;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setIdx((i) => (i + 1) % frames.length), 1000 / 30);
    return () => clearInterval(iv);
  }, [frames.length]);

  const sample = frames[idx];
  return (
    <View
      style={styles.stage}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && (
        <SkeletonOverlay landmarks={sample?.landmarks ?? null} width={size.w} height={size.h} accentColor={t.accent.color} hideLegs={hideLegs} sideView={sideView} showBar={showBar} />
      )}
      {sample?.activeCue ? <CueTag text={sample.activeCue} /> : null}
    </View>
  );
}

function CueTag({ text }: { text: string }) {
  return (
    <View style={[styles.cueTag, { backgroundColor: Feedback.warn }]}>
      <Text variant="caption" style={{ color: '#000' }}>
        {text}
      </Text>
    </View>
  );
}

function nearestSample(timeline: TimelineSample[], tms: number): TimelineSample {
  let best = timeline[0];
  let bestD = Infinity;
  for (let i = 0; i < timeline.length; i++) {
    const d = Math.abs(timeline[i].t - tms);
    if (d < bestD) {
      bestD = d;
      best = timeline[i];
    }
  }
  return best;
}

function Report({
  summary,
  scoreOverride,
  isNewRecord,
  previousBest,
}: {
  summary: SessionSummary;
  scoreOverride?: number | null;
  isNewRecord?: boolean;
  previousBest?: number | null;
}) {
  const t = useTheme();

  // Nothing was tracked — don't invent a score. Explain why instead.
  const nothingTracked = summary.mode === 'hold' ? summary.holdSeconds === 0 : summary.reps === 0;
  if (nothingTracked) {
    return (
      <View style={{ gap: Spacing.md, marginTop: Spacing.lg }}>
        <View style={[styles.notracked, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
          <Ionicons name="scan-outline" size={28} color={t.ink.secondary} />
          <Text variant="heading" style={{ textAlign: 'center' }}>
            No clean reps detected
          </Text>
          <Text tone="secondary" variant="caption" style={{ textAlign: 'center' }}>
            The camera didn&apos;t catch a full rep or hold. Check the framing tips on the exercise
            page, film from the angle it asks for, and make sure your whole body stays in view.
          </Text>
        </View>
      </View>
    );
  }

  const overall = scoreOverride ?? scoreSession(summary);
  const headline = summary.mode === 'hold' ? `${summary.holdSeconds}s` : `${summary.reps}`;
  const headlineLabel =
    summary.mode === 'hold' ? 'Best hold' : summary.attempts > 1 ? 'Best streak' : 'Reps';

  // Compute an overall form quality from available sub-scores.
  let formQuality: number | null = summary.formQuality;
  if (formQuality == null && (summary.depthScore != null || summary.consistencyScore != null)) {
    const parts: number[] = [];
    if (summary.depthScore != null) parts.push(summary.depthScore);
    if (summary.consistencyScore != null) parts.push(summary.consistencyScore);
    formQuality = Math.round(parts.reduce((s, v) => s + v, 0) / parts.length);
  }

  const stats: { label: string; value: string }[] = [
    { label: 'Duration', value: formatClock(summary.durationMs) },
  ];
  if (summary.attempts > 1) stats.push({ label: 'Attempts', value: String(summary.attempts) });
  if (summary.mode === 'reps' && summary.avgRepSeconds != null)
    stats.push({ label: 'Tempo', value: `${summary.avgRepSeconds}s/rep` });
  if (summary.romDegrees != null) stats.push({ label: 'Range', value: `${summary.romDegrees}°` });
  if (summary.avgBottomAngle != null) stats.push({ label: 'Avg depth', value: `${Math.round(summary.avgBottomAngle)}°` });

  return (
    <View style={{ gap: Spacing.md, marginTop: Spacing.lg }}>
      {isNewRecord && previousBest != null ? (
        <View style={[styles.prBanner, { backgroundColor: Feedback.good }]}>
          <Ionicons name="trophy" size={18} color="#000" />
          <Text variant="heading" style={{ color: '#000' }}>
            New personal best! Beat your previous {previousBest}
            {summary.mode === 'hold' ? 's' : ''} by {(summary.mode === 'hold' ? summary.holdSeconds : summary.reps) - previousBest}
          </Text>
        </View>
      ) : null}

      {/* Overall score */}
      <View style={[styles.scoreCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
        <View>
          <Text variant="label" tone="muted">
            Form score
          </Text>
          <Text style={[styles.scoreNum, { color: scoreColor(overall) }]}>{overall}</Text>
          <Text variant="caption" tone="secondary">
            {scoreWord(overall)}
          </Text>
        </View>
        <View style={styles.headlineWrap}>
          <Text variant="display" tone="accent">
            {headline}
          </Text>
          <Text variant="label" tone="secondary">
            {headlineLabel}
          </Text>
        </View>
      </View>

      {/* Form quality bar + sub-score bars */}
      <View style={{ gap: Spacing.sm }}>
        {formQuality != null ? (
          <ScoreBar label="Form quality" value={formQuality} />
        ) : null}
        {summary.formQuality != null ? <ScoreBar label="Straight line" value={summary.formQuality} /> : null}
        {summary.depthScore != null ? <ScoreBar label="Depth" value={summary.depthScore} /> : null}
        {summary.consistencyScore != null ? <ScoreBar label="Consistency" value={summary.consistencyScore} /> : null}
        {summary.avgBottomAngle != null && summary.targetAngle != null ? (
          <DepthGauge current={summary.avgBottomAngle} target={summary.targetAngle} />
        ) : null}
      </View>

      {/* Stat grid */}
      <View style={styles.statRow}>
        {stats.map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Text variant="heading">{s.value}</Text>
            <Text variant="caption" tone="secondary">
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Coach */}
      <CoachCard summary={summary} previousBest={previousBest ?? null} />

      {/* Form breakdown */}
      {summary.cues.length > 0 ? (
        <>
          <Text variant="heading" style={{ marginTop: Spacing.sm }}>
            Form breakdown
          </Text>
          {summary.cues.map((c) => (
            <CueLine key={c.ruleId} cue={c} durationMs={summary.durationMs} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function CoachCard({ summary, previousBest }: { summary: SessionSummary; previousBest: number | null }) {
  const t = useTheme();
  const { verdict, advice } = coachNotes(summary, { previousBest });
  return (
    <View style={[styles.coach, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={styles.coachHead}>
        <View style={[styles.coachBadge, { backgroundColor: t.accent.color }]}>
          <Ionicons name="person" size={16} color={t.accent.onColor} />
        </View>
        <Text variant="heading" style={{ flex: 1 }}>
          Coach
        </Text>
      </View>
      <Text variant="body" style={{ marginTop: Spacing.xs }}>
        {verdict}
      </Text>
      <View style={{ gap: Spacing.sm, marginTop: Spacing.sm }}>
        {advice.map((a, i) => (
          <View key={i} style={styles.adviceRow}>
            <Ionicons name="arrow-forward" size={16} color={t.accent.color} style={{ marginTop: 3 }} />
            <Text variant="body" tone="secondary" style={{ flex: 1 }}>
              {a}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.barHead}>
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        <Text variant="caption" style={{ color: scoreColor(value) }}>
          {value}
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: t.surface.sunken }]}>
        <View style={[styles.barFill, { width: `${value}%`, backgroundColor: scoreColor(value) }]} />
      </View>
    </View>
  );
}

function CueLine({ cue, durationMs }: { cue: CueTally; durationMs: number }) {
  const t = useTheme();
  const totalFrames = Math.max(1, Math.round(durationMs / 33));
  const pct = Math.min(100, Math.round((cue.frames / totalFrames) * 100));
  const color = cue.severity === 'warn' ? Feedback.bad : Feedback.warn;
  return (
    <View style={[styles.cueRow, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="body" style={{ flex: 1 }}>
        {cue.cue}
      </Text>
      <Text variant="caption" tone="secondary">
        {pct}% of set
      </Text>
    </View>
  );
}

/**
 * Coach's verdict on where to go next. Ready = solid score AND real volume
 * (a hold needs time, not just clean form); struggling = point to the easier
 * step in the same family. Both tap through to that exercise.
 */
function ProgressionAdvice({ summary }: { summary: SessionSummary }) {
  const t = useTheme();
  const ex = getExercise(summary.exerciseId);
  if (!ex) return null;

  const score = scoreSession(summary);
  const value = summary.mode === 'hold' ? summary.holdSeconds : summary.reps;
  const volumeOk = summary.mode === 'hold' ? summary.holdSeconds >= 15 : summary.reps >= 8;
  // A real result (10s hold / 4 reps) NEVER earns a downgrade — only genuine failure does.
  const struggling =
    score < 55 &&
    (summary.mode === 'hold' ? summary.holdSeconds < 5 : summary.reps <= 2 && summary.attempts >= 2);

  const next = getNextProgression(ex);
  const prev = getPrevProgression(ex);

  let card: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; body: string; target: typeof next } | null = null;
  if (score >= 72 && volumeOk && next) {
    card = {
      icon: 'trending-up',
      color: Feedback.good,
      title: `You're ready for ${next.name}`,
      body:
        summary.mode === 'hold'
          ? `Clean form held for ${summary.holdSeconds}s — time to level up.`
          : `${summary.reps} solid reps with good form — time to level up.`,
      target: next,
    };
  } else if ((value === 0 || struggling) && prev) {
    card = {
      icon: 'trending-down',
      color: Feedback.warn,
      title: `Build up with ${prev.name}`,
      body: 'This one isn’t quite there yet — owning the easier step will get you there faster.',
      target: prev,
    };
  }
  if (!card || !card.target) return null;
  const target = card.target;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/exercise/[slug]', params: { slug: target.slug } })}
      style={({ pressed }) => [
        styles.advice,
        { backgroundColor: t.surface.raised, borderColor: card.color, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name={card.icon} size={22} color={card.color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading">{card.title}</Text>
        <Text variant="caption" tone="secondary">
          {card.body}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.ink.muted} />
    </Pressable>
  );
}

/** A horizontal gauge showing the average depth angle relative to the target. */
function DepthGauge({ current, target }: { current: number; target: number }) {
  const t = useTheme();
  const pct = Math.min(100, Math.max(0, Math.round((1 - Math.abs(current - target) / 90) * 100)));
  const color = pct >= 80 ? Feedback.good : pct >= 55 ? Feedback.warn : Feedback.bad;
  return (
    <View style={[styles.depthGaugeCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={styles.depthGaugeHead}>
        <Text variant="label" tone="secondary">Avg depth</Text>
        <Text variant="caption" style={{ color }}>{Math.round(current)}° / {target}° target</Text>
      </View>
      <View style={[styles.depthGaugeTrack, { backgroundColor: t.surface.sunken }]}>
        <View style={{ flexDirection: 'row', height: '100%' }}>
          {/* Target zone indicator */}
          <View style={[styles.depthTargetZone, { left: `${Math.max(0, (target - 20) / 180 * 100)}%`, width: `${40 / 180 * 100}%` }]} />
          {/* Current depth marker */}
          <View style={[styles.depthMarker, { left: `${Math.min(100, Math.max(0, current / 180 * 100))}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {Math.abs(current - target) <= 15 ? 'On target' : current < target ? 'Not deep enough' : 'Too deep'}
      </Text>
    </View>
  );
}

function scoreColor(v: number): string {
  return v >= 80 ? Feedback.good : v >= 55 ? Feedback.warn : Feedback.bad;
}
function scoreWord(v: number): string {
  return v >= 90 ? 'Excellent' : v >= 80 ? 'Strong' : v >= 55 ? 'Solid — room to sharpen' : 'Needs work';
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  advice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  notracked: {
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  replayControls: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  controlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  stage: {
    height: 340,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginTop: Spacing.md,
    backgroundColor: '#050506',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageOuter: { marginTop: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  videoBox: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#050506',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  mirror: { transform: [{ scaleX: -1 }] },
  overlayLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, elevation: 5 },
  cueTag: {
    position: 'absolute',
    bottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  // Centered on the video's right edge, at about 70% of full size — the live
  // camera gauge is full-size against a full screen, but the replay video box
  // is much shorter, so a same-size gauge used to crowd it and sit too high.
  replayGaugeWrap: { position: 'absolute', right: 6, top: '50%', width: 22, height: 190, marginTop: -95 },
  replayGaugeInner: { position: 'relative', top: 0, right: 0, marginTop: 0, width: 22, height: 190, borderRadius: 11 },
  actionBadge: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  prBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  scoreCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  scoreNum: { fontSize: 52, fontWeight: '800', letterSpacing: -1.5 },
  headlineWrap: { alignItems: 'flex-end' },
  barHead: { flexDirection: 'row', justifyContent: 'space-between' },
  barTrack: { height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 2,
  },
  coach: { padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, marginTop: Spacing.sm },
  coachHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  coachBadge: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  adviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  clean: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  depthGaugeCard: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.sm },
  depthGaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  depthGaugeTrack: { height: 20, borderRadius: Radius.pill, overflow: 'hidden', position: 'relative' },
  depthTargetZone: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(48,209,88,0.2)', borderRadius: Radius.pill },
  depthMarker: { position: 'absolute', top: 2, bottom: 2, width: 4, marginLeft: -2, borderRadius: 2 },
});
