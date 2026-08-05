import { Ionicons } from '@expo/vector-icons';
import * as StoreReview from 'expo-store-review';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Atmosphere } from '@/components/Atmosphere';
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
import { schedulePushToCloud } from '@/lib/icloudSync';
import { useSettings } from '@/store/settings';
import { useSubscription } from '@/store/subscription';
import { formatClock } from '@/lib/format';

import { SkeletonOverlay } from '@/pose/SkeletonOverlay';
import { useSessionStore } from '@/store/session';
import { deleteSession, getSession, listSessionsForExercise, saveSession } from '@/storage/db';
import { alpha, Feedback, formQualityColor, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const PAD_MS = 3000;

export default function ReviewScreen() {
  const t = useTheme();
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
  const [formTrend, setFormTrend] = useState<{ dir: 'up' | 'down' | 'flat'; msg: string } | null>(null);

  useEffect(() => {
    if (!summary) return;
    const exerciseId = summary.exerciseId;
    listSessionsForExercise(exerciseId).then((sessions) => {
      const past = sessions.filter((s) => s.score != null && s.id !== id).slice(0, 3);
      if (past.length < 2) return;
      const pastAvg = past.reduce((a, s) => a + (s.score ?? 0), 0) / past.length;
      const curScore = historyScore ?? (summary ? scoreSession(summary) : 0);
      const diff = curScore - pastAvg;
      if (diff > 8) setFormTrend({ dir: 'up', msg: `Form trending up — +${Math.round(diff)}pts from your last ${past.length} sessions` });
      else if (diff < -8) setFormTrend({ dir: 'down', msg: `Form dipping — ${Math.round(-diff)}pts below your average. Focus on the cues below.` });
      else setFormTrend({ dir: 'flat', msg: 'Form holding steady — keep that consistency.' });
    }).catch(() => {});
  }, [summary, id, historyScore]);
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
        totalReps: rec.totalReps ?? rec.reps,
        totalHoldSeconds: rec.totalHoldSeconds ?? rec.holdSeconds,
        activeMs: rec.activeMs ?? rec.durationMs,
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
        segments: rec.segments,
        // Not persisted to the DB — a reopened history session falls back to
        // the exercise's static gauge config, same as before this field
        // existed. Only a FRESH finish (still in the in-memory handoff) has
        // the real, possibly-recalibrated thresholds live tracking ended on.
        repThresholds: null,
      });
    });
  }, [id, fromStore]);

  const segments = useMemo(() => computeSegments(summary, timeline), [summary, timeline]);
  // Off by default — the live view no longer shows the raw skeleton either
  // (see ExerciseTracker.tsx), so this screen shouldn't be the one place
  // it's on by default. Still one tap away via the ControlPill below for
  // anyone curious how the tracking actually looked.
  const [showSkeleton, setShowSkeleton] = useState(false);
  const insets = useSafeAreaInsets();

  // A fresh finish (fromStore set) hasn't hit the DB yet under the deferred-
  // save model — only "Save workout" persists it. A reopened history session
  // (fromStore null, loaded via getSession) is inherently already-saved.
  const [persisted, setPersisted] = useState(false);
  const unsaved = !!fromStore && !persisted;
  const [saving, setSaving] = useState(false);
  const reviewPrompted = useSettings((s) => s.reviewPrompted);
  const premiumReviewPrompted = useSettings((s) => s.premiumReviewPrompted);
  const setReviewPrompted = useSettings((s) => s.setReviewPrompted);
  const setPremiumReviewPrompted = useSettings((s) => s.setPremiumReviewPrompted);
  const hasAllAccess = useSubscription((s) => s.hasAllAccess);

  const leave = useCallback(() => {
    clear();
    router.dismissAll?.();
    router.replace('/(tabs)');
  }, [clear]);

  const saveWorkout = useCallback(async () => {
    if (!fromStore || !summary || saving) return;
    setSaving(true);
    try {
      await saveSession(fromStore.id, fromStore.exerciseName, fromStore.createdAt, summary, videoUri, timeline ?? [], videoAspect);
      schedulePushToCloud();
      setPersisted(true);
      const shouldAsk = hasAllAccess ? !premiumReviewPrompted : !reviewPrompted;
      if (shouldAsk && await StoreReview.isAvailableAsync()) {
        if (hasAllAccess) setPremiumReviewPrompted(true);
        else setReviewPrompted(true);
        await StoreReview.requestReview().catch(() => {});
      }
      leave();
    } catch {
      setSaving(false);
      Alert.alert("Couldn't save", 'Something went wrong saving this set. Try again.');
    }
  }, [fromStore, summary, videoUri, timeline, videoAspect, saving, leave, hasAllAccess, premiumReviewPrompted, reviewPrompted, setPremiumReviewPrompted, setReviewPrompted]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, []);

  const onBackPress = useCallback(() => {
    if (unsaved) {
      Alert.alert("Discard this set?", "It hasn't been saved yet — going back won't keep it.", [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { clear(); goBack(); } },
      ]);
    } else {
      clear();
      goBack();
    }
  }, [unsaved, clear, goBack]);

  const onDeletePress = useCallback(() => {
    Alert.alert('Delete this session?', "This exercise will be removed from your history. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSession(id);
            clear();
            goBack();
          } catch {
            Alert.alert("Couldn't delete", 'Something went wrong deleting this session. Try again.');
          }
        },
      },
    ]);
  }, [id, clear, goBack]);

  return (
    <>
       <Screen scroll>
       <Atmosphere />
       <View style={styles.header}>
        <BackButton onPress={onBackPress} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="muted">
            Set Review
          </Text>
          <Text variant="title">{exerciseName || 'Workout'}</Text>
        </View>
        {!unsaved ? (
          <Pressable onPress={onDeletePress} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="trash-outline" size={20} color={t.ink.muted} />
          </Pressable>
        ) : null}
      </View>

      <ReplayStage
        videoUri={videoUri}
        timeline={timeline}
        segments={segments}
        aspect={videoAspect}
        exerciseId={summary?.exerciseId ?? null}
        repThresholds={summary?.repThresholds ?? null}
        showSkeleton={showSkeleton}
        hideLegs={!!(summary && getExercise(summary.exerciseId)?.hideLegs)}
        sideView={!!(summary && getExercise(summary.exerciseId)?.view === 'side')}
        showBar={!!(summary && getExercise(summary.exerciseId)?.showBar)}
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
            icon="share-outline"
            label="Share"
            onPress={async () => {
              if (!videoUri) return;
              try {
                await Sharing.shareAsync(videoUri, { mimeType: 'video/mp4', dialogTitle: 'Share workout replay' });
              } catch {}
            }}
          />
        </View>
      ) : null}

      {summary ? (
        <Report summary={summary} scoreOverride={historyScore} isNewRecord={isNewRecord} previousBest={previousBest} formTrend={formTrend} />
      ) : (
        <Text tone="muted">Loading…</Text>
      )}
      {summary ? <ProgressionAdvice summary={summary} /> : null}

      {/* Screen already contributes 48pt of scroll padding. Add only the
          remaining height needed to clear the fixed save bar, including the
          device's bottom safe area. */}
      <View style={{ height: Spacing.xl + Spacing.sm + insets.bottom }} />
    </Screen>
    <View style={[styles.saveBar, { paddingBottom: insets.bottom + Spacing.md }]} pointerEvents="box-none">
      <View style={[styles.savePill, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
        <PrimaryButton
          label={unsaved ? (saving ? 'Saving…' : 'Save workout') : 'Done'}
          disabled={saving}
          onPress={unsaved ? saveWorkout : leave}
        />
      </View>
    </View>
    {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
    </>
  );
}

type Segment = { startMs: number; endMs: number; reps: number; realStartMs?: number; realEndMs?: number };

/** Prefer the summary's real per-attempt segments (the full stitched
 * highlight reel); fall back to a single padded window around firstActionMs/
 * lastActionMs for old data saved before `segments` existed. */
function computeSegments(summary: SessionSummary | null, timeline: TimelineSample[] | null): Segment[] {
  if (summary && summary.segments.length > 0) return summary.segments;
  const tlStart = timeline?.[0]?.t ?? 0;
  const tlEnd = timeline?.[timeline.length - 1]?.t ?? summary?.durationMs ?? 0;
  const first = summary?.firstActionMs ?? tlStart;
  const last = summary?.lastActionMs ?? tlEnd;
  return [
    {
      startMs: Math.max(0, first - PAD_MS),
      endMs: Math.min(tlEnd || last + PAD_MS, last + PAD_MS),
      reps: 0,
      realStartMs: first,
      realEndMs: last,
    },
  ];
}

function ReplayStage({
  videoUri,
  timeline,
  segments,
  aspect,
  exerciseId,
  repThresholds = null,
  showSkeleton = true,
  hideLegs = false,
  sideView = false,
  showBar = false,
}: {
  videoUri: string | null;
  timeline: TimelineSample[] | null;
  segments: Segment[];
  aspect?: number;
  exerciseId: string | null;
  repThresholds?: { downBelow: number; upAbove: number } | null;
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
        segments={segments}
        aspect={aspect}
        exerciseId={exerciseId}
        repThresholds={repThresholds}
        showSkeleton={showSkeleton}
        hideLegs={hideLegs}
        sideView={sideView}
        showBar={showBar}
      />
    );
  if (timeline && timeline.length > 0)
    return <SkeletonReplay timeline={timeline} segments={segments} hideLegs={hideLegs} sideView={sideView} showBar={showBar} />;
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

/**
 * Single attempt: "Starts in 2.1s" → "Tracking · 12s" → "Finished", same as
 * before. Multiple attempts (a stitched highlight reel): a starts-in/
 * finished countdown doesn't map cleanly onto a loop of several separate
 * clips, so this switches to "Set 2 of 3 · 8 reps" instead.
 */
function ActionBadge({ tMs, segments, segIdx, liveReps }: { tMs: number; segments: Segment[]; segIdx: number; liveReps: number | null }) {
  const t = useTheme();
  const seg = segments[segIdx];
  if (!seg) return null;
  let text: string;
  let bg = 'rgba(0,0,0,0.55)';
  // For a hold segment, the REAL hold boundaries sit inside the padded
  // startMs/endMs window (3s lead-in/lead-out — see buildReplaySegments).
  // Everything below reads against realStartMs/realEndMs when present
  // (falling back to the padded bounds for older sessions saved before this
  // field existed) so the badge's "Starts in"/"Tracking"/"Finished" text
  // matches when the athlete actually went up and came down — not the wider
  // padded window the video shows around that.
  const realStart = seg.realStartMs ?? seg.startMs;
  const realEnd = seg.realEndMs ?? seg.endMs;
  if (segments.length > 1) {
    text = seg.reps > 0 ? `Set ${segIdx + 1} of ${segments.length} · ${seg.reps} reps` : `Set ${segIdx + 1} of ${segments.length}`;
    bg = t.accent.color;
  } else if (tMs < seg.startMs) {
    text = `Starts in ${Math.max(0, (seg.startMs - tMs) / 1000).toFixed(1)}s`;
  } else if (seg.reps === 0 && tMs < realStart) {
    // Still in the hold's own lead-in padding — the clip has started, but
    // the athlete hasn't gone up yet.
    text = `Starts in ${Math.max(0, (realStart - tMs) / 1000).toFixed(1)}s`;
  } else if (seg.reps === 0 && tMs > realEnd) {
    // Already came down — the clip continues into lead-out padding, but the
    // hold itself is over, same as the very last branch below.
    text = 'Finished';
  } else if (tMs <= seg.endMs + 250) {
    // reps:0 marks a hold segment (see buildReplaySegments) — holds show a
    // running clock counted from the REAL start, which is accurate by
    // construction now (tMs - realStart really is the hold duration so far).
    // Reps segments show the REAL recorded rep count at this frame
    // (TimelineSample.reps, captured live at record time) — falls back to a
    // flat "Tracking" (no number) rather than guessing one for older
    // sessions saved before that field existed.
    if (seg.reps === 0) {
      text = `Tracking · ${Math.floor((tMs - realStart) / 1000)}s`;
    } else if (liveReps != null) {
      text = `Tracking · ${liveReps} rep${liveReps === 1 ? '' : 's'}`;
    } else {
      text = 'Tracking';
    }
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

/**
 * Real recorded video, played through each replay segment in order with the
 * skeleton synced on top — a jump-cut to the next segment's start the moment
 * the current one ends, looping back to the first after the last. There's no
 * real video editing in this stack, so a multi-attempt "highlight reel" is
 * built this way: one continuous recorded clip, seeked around at playback
 * time. A single segment (the common case) behaves exactly as before.
 */
function VideoReplay({
  uri,
  timeline,
  segments,
  aspect,
  exerciseId,
  repThresholds = null,
  showSkeleton = true,
  hideLegs = false,
  sideView = false,
  showBar = false,
}: {
  uri: string;
  timeline: TimelineSample[] | null;
  segments: Segment[];
  aspect?: number;
  exerciseId: string | null;
  repThresholds?: { downBelow: number; upAbove: number } | null;
  showSkeleton?: boolean;
  hideLegs?: boolean;
  sideView?: boolean;
  showBar?: boolean;
}) {
  const t = useTheme();
  // Front-camera recordings have the mirror BAKED INTO the video file's
  // pixels: VisionCamera's recorder writes the same (mirrored) sensor
  // buffers the frame processor sees, and useCameraPose un-mirrors only the
  // LANDMARKS into true space — the file keeps mirror-view pixels. (Device-
  // confirmed: applying a CSS flip to the video here made a handstand's
  // video and skeleton lean opposite ways.) So: the video is never
  // CSS-flipped — its natural mirror-view look matches the live self-view —
  // and the true-space landmarks get mirrored in frame space (inside the
  // cover transform below) to land back on the recorded pixels. Back-camera
  // files are true-space, so nothing flips anywhere.
  const mirrorLandmarks = false;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tMs, setTMs] = useState(0);
  const [segIdx, setSegIdx] = useState(0);
  const [sample, setSample] = useState<TimelineSample | null>(timeline?.[0] ?? null);

  const ex = exerciseId ? getExercise(exerciseId) : null;
  const gauge = ex?.gauge ?? null;
  const anglesFn = ex?.angles ?? null;
  const [gaugeMarker, setGaugeMarker] = useState(0);

  const player = useVideoPlayer(uri, (p) => {
    // Native loop as a safety net alongside the per-segment re-seek below: if
    // the computed windows are ever slightly off, this guarantees the clip
    // restarts instead of just freezing on the final frame.
    p.loop = true;
    p.muted = true;
  });

  // A ref, not just the segIdx state, so the polling interval below always
  // reads the CURRENT segment synchronously (state read in a setInterval
  // closure would stay stuck at whatever it was when the effect last ran).
  const segIdxRef = useRef(0);

  useEffect(() => {
    segIdxRef.current = 0;
    setSegIdx(0);
  }, [segments]);

  useEffect(() => {
    if (segments.length === 0) return;
    const seekTo = (idx: number) => {
      try {
        player.currentTime = segments[idx].startMs / 1000;
      } catch {}
    };
    seekTo(segIdxRef.current);
    player.play();
    const iv = setInterval(() => {
      const seg = segments[segIdxRef.current];
      const startSec = seg.startMs / 1000;
      const endSec = Math.max(startSec + 0.5, seg.endMs / 1000);
      let ct = 0;
      try {
        ct = player.currentTime ?? 0;
      } catch {}
      if (ct >= endSec || ct < startSec - 0.15) {
        const nextIdx = (segIdxRef.current + 1) % segments.length;
        segIdxRef.current = nextIdx;
        setSegIdx(nextIdx);
        seekTo(nextIdx);
        ct = segments[nextIdx].startMs / 1000;
      }
      setTMs(ct * 1000);
      if (timeline) {
        const s = interpolateSample(timeline, ct * 1000);
        setSample(s);
        // Compute gauge marker from the interpolated sample's landmarks
        if (gauge && anglesFn && s) {
          const a = anglesFn(s.landmarks)[gauge.angle];
          if (a != null) setGaugeMarker(Math.min(1, Math.max(0, a / 180)));
        }
      }
    }, 66);
    return () => clearInterval(iv);
  }, [player, segments, timeline, gauge, anglesFn]);

  // Full-width, cover-cropped stage: the video fills the box (cropping the
  // frame's excess height) so the athlete reads large and centered instead
  // of a narrow letterboxed strip.
  const H = 440;
  const gaugeVis = gauge && anglesFn && sample != null;

  // Landmarks are stored normalized against the FULL video frame — with the
  // video cover-cropped into the box, they must go through the exact same
  // scale+center-crop mapping (and the front-camera mirror, see above) or
  // the skeleton lands beside the body.
  const frameAspect = aspect && aspect > 0 ? aspect : null;
  const displayLandmarks = useMemo(() => {
    if (!sample || size.w === 0 || size.h === 0) return null;
    const viewRatio = size.w / size.h;
    const fr = frameAspect ?? viewRatio; // unknown aspect: assume it fills the box
    let drawnW: number;
    let drawnH: number;
    if (fr > viewRatio) {
      drawnH = size.h;
      drawnW = size.h * fr;
    } else {
      drawnW = size.w;
      drawnH = size.w / fr;
    }
    const xoff = (size.w - drawnW) / 2;
    const yoff = (size.h - drawnH) / 2;
    return sample.landmarks.map((lm) => ({
      ...lm,
      x: ((mirrorLandmarks ? 1 - lm.x : lm.x) * drawnW + xoff) / size.w,
      y: (lm.y * drawnH + yoff) / size.h,
    }));
  }, [sample, size, frameAspect, mirrorLandmarks]);

  return (
    <View style={styles.stageOuter}>
      <View
        style={[styles.videoBox, { width: '100%', height: H }]}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
        {/* Overlays live in their own stacking layer so the native video can't
            paint over the skeleton + timer. */}
        <View style={styles.overlayLayer} pointerEvents="none">
          {/* Not during the "Starts in Xs" lead-in pad — the skeleton
              shouldn't be sitting there before the exercise itself begins,
              same as the live countdown before a fresh set. */}
          {showSkeleton && displayLandmarks && tMs >= (segments[segIdx]?.startMs ?? 0) ? (
            <SkeletonOverlay landmarks={displayLandmarks} width={size.w} height={size.h} accentColor={t.accent.color} hideLegs={hideLegs} sideView={sideView} showBar={showBar} />
          ) : null}
          <ActionBadge tMs={tMs} segments={segments} segIdx={segIdx} liveReps={sample?.reps ?? null} />
          {sample?.activeCue ? <CueTag text={sample.activeCue} /> : null}
        </View>
        {gaugeVis ? (
          <View style={styles.replayGaugeWrap}>
            {ex?.mode === 'hold' ? (
              <QualityGauge marker={gaugeMarker} target={gauge.target / 180} visible style={styles.replayGaugeInner} />
            ) : (
              <RepGauge
                marker={gaugeMarker}
                // The counter's actual final thresholds when known (a fresh
                // finish) — falling back to the exercise's static config only
                // for a reopened history session that predates this field.
                // Otherwise, for an adaptive exercise that recalibrated
                // mid-set, this bar would show a DIFFERENT zone than the one
                // the live bar (and the counter) actually used.
                down={(repThresholds?.downBelow ?? gauge.downBelow) / 180}
                up={(repThresholds?.upAbove ?? gauge.upAbove) / 180}
                visible
                smooth={false}
                style={styles.replayGaugeInner}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Fallback: animated skeleton stepping through every replay segment's
 * frames in order (concatenated, not seeked — there's no real video here to
 * seek within, just a raw frame array, so "stitching" is just building one
 * combined array up front). */
function SkeletonReplay({ timeline, segments, hideLegs = false, sideView = false, showBar = false }: { timeline: TimelineSample[]; segments: Segment[]; hideLegs?: boolean; sideView?: boolean; showBar?: boolean }) {
  const t = useTheme();
  const clip = useMemo(
    () => segments.flatMap((seg) => timeline.filter((s) => s.t >= seg.startMs && s.t <= seg.endMs)),
    [timeline, segments],
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

/**
 * `timeline` is always chronologically sorted (every consumer of it assumes
 * this), so the nearest sample to a given time is a binary search away
 * instead of a full linear scan — this runs on every ~66ms replay poll tick,
 * so for a long multi-set session that's the difference between a handful of
 * comparisons and scanning the whole recorded timeline, repeatedly, the
 * entire time a review is open. Correct for both forward playback and the
 * backward jumps segment looping causes (a plain binary search doesn't care
 * which direction the target moved from the last call).
 */
function nearestSample(timeline: TimelineSample[], tms: number): TimelineSample {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t < tms) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first index with t >= tms (or the last index if tms is past
  // the end) — the true nearest could still be the one just before it.
  if (lo > 0 && Math.abs(timeline[lo - 1].t - tms) <= Math.abs(timeline[lo].t - tms)) return timeline[lo - 1];
  return timeline[lo];
}

/** Don't blend across a real capture gap (an attempt break, an out-of-frame
 * pause) — a lerp between poses seconds apart invents movement that never
 * happened. Anything under this is normal frame spacing. */
const MAX_LERP_GAP_MS = 500;

/**
 * nearestSample + linear interpolation between the two bracketing samples,
 * so the replayed skeleton moves every poll tick instead of stepping at the
 * (much coarser) captured frame rate — the recorded timeline is only as
 * dense as live inference managed on-device, and snapping to it looks like
 * single-digit-fps playback over a smooth video.
 */
function interpolateSample(timeline: TimelineSample[], tms: number): TimelineSample {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t < tms) lo = mid + 1;
    else hi = mid;
  }
  const b = timeline[lo];
  const a = lo > 0 ? timeline[lo - 1] : null;
  if (!a || b.t <= tms || tms <= a.t) return nearestSample(timeline, tms);
  const gap = b.t - a.t;
  if (gap > MAX_LERP_GAP_MS || a.landmarks.length !== b.landmarks.length) {
    return nearestSample(timeline, tms);
  }
  const k = (tms - a.t) / gap;
  const nearer = k < 0.5 ? a : b;
  return {
    t: tms,
    activeCue: nearer.activeCue,
    reps: nearer.reps,
    landmarks: a.landmarks.map((la, i) => {
      const lb = b.landmarks[i];
      return {
        x: la.x + (lb.x - la.x) * k,
        y: la.y + (lb.y - la.y) * k,
        z: la.z + (lb.z - la.z) * k,
        visibility: Math.min(la.visibility, lb.visibility),
      };
    }),
  };
}

function Report({
  summary,
  scoreOverride,
  isNewRecord,
  previousBest,
  formTrend,
}: {
  summary: SessionSummary;
  scoreOverride?: number | null;
  isNewRecord?: boolean;
  previousBest?: number | null;
  formTrend?: { dir: 'up' | 'down' | 'flat'; msg: string } | null;
}) {
  const t = useTheme();

  // Nothing was tracked — don't invent a score. Explain why instead.
  const nothingTracked = summary.mode === 'hold' ? summary.holdSeconds === 0 : summary.totalReps === 0;
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
  const headline = summary.mode === 'hold' ? `${summary.holdSeconds}s` : `${summary.totalReps}`;
  const headlineLabel =
    summary.mode === 'hold' ? 'Best hold' : 'Total reps';

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
  if (summary.mode === 'reps' && summary.totalReps > summary.reps)
    stats.push({ label: 'Best streak', value: String(summary.reps) });
  if (summary.mode === 'hold' && summary.totalHoldSeconds > summary.holdSeconds)
    stats.push({ label: 'Total time', value: `${summary.totalHoldSeconds}s` });
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
          <Text style={[styles.scoreNum, { color: formQualityColor(overall) }]}>{overall}</Text>
          <Text variant="caption" tone="secondary">
            {scoreWord(overall)}
          </Text>
        </View>
        <View style={styles.headlineWrap}>
          {/* Plain white, not accent — it already sits next to the form
              score's own semantic color (scoreColor), so tinting this too
              was two competing oranges in the same card. */}
          <Text variant="display">
            {headline}
          </Text>
          <Text variant="label" tone="secondary">
            {headlineLabel}
          </Text>
        </View>
      </View>

      {/* Form quality bar + sub-score bars */}
      <View style={{ gap: Spacing.sm, marginTop: Spacing.sm }}>
        {formQuality != null ? (
          <ScoreBar label="Form quality" value={formQuality} />
        ) : null}
        {summary.formQuality != null ? <ScoreBar label="Straight line" value={summary.formQuality} /> : null}
        {summary.depthScore != null ? <ScoreBar label="Depth" value={summary.depthScore} /> : null}
        {summary.consistencyScore != null ? <ScoreBar label="Consistency" value={summary.consistencyScore} /> : null}
        {summary.avgBottomAngle != null && summary.targetAngle != null ? (
          <View style={{ marginTop: Spacing.sm }}>
            <DepthGauge current={summary.avgBottomAngle} target={summary.targetAngle} />
          </View>
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
      <AICoachCard summary={summary} previousBest={previousBest ?? null} formTrend={formTrend} />

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

function AICoachCard({ summary, previousBest, formTrend }: { summary: SessionSummary; previousBest: number | null; formTrend?: { dir: 'up' | 'down' | 'flat'; msg: string } | null }) {
  const t = useTheme();
  const { verdict, advice } = coachNotes(summary, { previousBest });
  const [speaking, setSpeaking] = useState(false);
  const spokenReview = [verdict, ...advice].join(' ');
  const toggleSpeech = () => {
    if (speaking) {
      Speech.stop().catch(() => {});
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak(spokenReview, {
      rate: 0.92,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };
  return (
    <View
      style={[styles.coach, { backgroundColor: `${t.accent.color}0D`, borderColor: `${t.accent.color}45` }]}
    >
      <View style={styles.coachHead}>
        <View
          style={[styles.coachBadge, { backgroundColor: t.accent.color }]}
        >
          <Ionicons name="sparkles" size={16} color={t.accent.onColor} />
        </View>
        <Text variant="heading" style={{ flex: 1 }}>
          AI coach
        </Text>
        <Pressable onPress={toggleSpeech} style={[styles.listenButton, { borderColor: `${t.accent.color}55` }]} accessibilityRole="button">
          <Ionicons name={speaking ? 'stop' : 'volume-high-outline'} size={15} color={t.accent.color} />
          <Text variant="caption" tone="accent">{speaking ? 'Stop' : 'Listen'}</Text>
        </Pressable>
      </View>
      <Text variant="caption" tone="muted" style={{ marginTop: Spacing.xs }}>Generated from your movement data</Text>
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
      {formTrend ? (
        <View style={[styles.coachTrend, { borderColor: t.ink.hairline }]}>
          <Ionicons
            name={formTrend.dir === 'up' ? 'trending-up' : formTrend.dir === 'down' ? 'trending-down' : 'remove-outline'}
            size={18}
            color={formTrend.dir === 'up' ? Feedback.good : formTrend.dir === 'down' ? Feedback.warn : t.ink.secondary}
          />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>{formTrend.msg}</Text>
        </View>
      ) : null}
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
        <Text variant="caption" style={{ color: formQualityColor(value) }}>
          {value}
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: t.surface.sunken }]}>
        <View style={[styles.barFill, { width: `${value}%`, backgroundColor: formQualityColor(value) }]} />
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
  const color = formQualityColor(pct);
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

function scoreWord(v: number): string {
  return v >= 90 ? 'Excellent' : v >= 80 ? 'Strong' : v >= 55 ? 'Solid — room to sharpen' : 'Needs work';
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.page,
    paddingTop: Spacing.md,
  },
  savePill: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },
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
  overlayLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, elevation: 5 },
  cueTag: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.md,
    // Matches ActionBadge's inset (top: Spacing.md, left: Spacing.md) — this
    // used to have no left offset at all and sat flush against the video's
    // edge. maxWidth stops a long cue from running edge-to-edge.
    maxWidth: '75%',
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
   listenButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1 },
  adviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  coachTrend: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1 },
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
  depthTargetZone: { position: 'absolute', top: 0, bottom: 0, backgroundColor: alpha(Feedback.good, 0.2), borderRadius: Radius.pill },
  depthMarker: { position: 'absolute', top: 2, bottom: 2, width: 4, marginLeft: -2, borderRadius: 2 },
  trendCard: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
});
