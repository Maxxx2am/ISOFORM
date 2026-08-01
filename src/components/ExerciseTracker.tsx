import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';


import { CircularTimer } from '@/components/CircularTimer';
import { QualityGauge } from '@/components/QualityGauge';
import { RepGauge } from '@/components/RepGauge';
import { Text } from '@/components/Text';
import { bodyInView, facingDirection } from '@/engine/angles';
import { SessionEngine, type LiveState, type SessionSummary, type TimelineSample } from '@/engine/sessionEngine';
import type { Exercise } from '@/exercises/types';
import { announceGoal, initCoachAudio, playDing, speakCue, stopCoachAudio, tripleBeep } from '@/lib/audio';
import { formatClock } from '@/lib/format';
import { SkeletonOverlay, type BodyHighlight } from '@/pose/SkeletonOverlay';
import type { Landmark, PoseFrame } from '@/pose/types';
import { useSettings } from '@/store/settings';
import type { ExerciseGoal } from '@/store/workouts';
import { alpha, Feedback, formQualityColor, Ink, Radius, Spacing, Surface } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Phase = 'setup' | 'tracking' | 'processing';

/**
 * Real MediaPipe confidence is noisy frame-to-frame — a required joint's
 * visibility can flicker across the 0.4 threshold even while the athlete
 * hasn't moved, which without debouncing flips `fullBody` false for a single
 * frame and (during setup) cancels the 3-2-1 countdown right back to the
 * "step back" gate, over and over. This grace window absorbs that flicker
 * the same way REP_BREAK_MS/HOLD_BREAK_MS absorb a brief tracking hiccup
 * elsewhere — only a loss that lasts longer than this actually counts.
 */
const FULL_BODY_DEBOUNCE_MS = 400;

/**
 * How long a facing mismatch (facing the camera when the move wants a side
 * profile, or vice versa) must hold continuously during setup before the
 * "turn around" message shows — a person naturally rotates into position
 * while getting set up, and `facingDirection` briefly reads the in-between
 * turn as the wrong side before settling; this absorbs that instead of
 * flashing the warning on every setup.
 */
const FACING_MISMATCH_DEBOUNCE_MS = 700;



/** Returns true when the live state has meaningfully changed — avoids a React
 *  re-render on every single frame when nothing the UI shows actually changed. */
function liveDiffers(a: LiveState, b: LiveState): boolean {
  return a.reps !== b.reps || a.bestReps !== b.bestReps || a.holdSeconds !== b.holdSeconds ||
    a.bestHoldSeconds !== b.bestHoldSeconds || a.attempts !== b.attempts ||
    a.activeCue !== b.activeCue || a.activeSeverity !== b.activeSeverity ||
    a.activeBodyPart !== b.activeBodyPart || a.lastRep !== b.lastRep ||
    a.repMiss !== b.repMiss || a.formQuality !== b.formQuality ||
    a.cleanReps !== b.cleanReps || a.inPosition !== b.inPosition;
}

export type ExerciseTrackerResult = {
  summary: SessionSummary;
  timeline: TimelineSample[];
  videoUri: string | null;
  videoAspect?: number;
};

/**
 * The single live-tracking view: camera + skeleton stage, full-body gate +
 * countdown, glitch filtering, SessionEngine wiring, gauges, HUD. Shared by
 * the solo `workout/active` screen and the multi-exercise `workout/run`
 * runner so tracking bugfixes only ever need to happen in one place.
 *
 * Pose frames come from CameraStage's on-device MediaPipe tracker
 * (src/camera/useCameraPose.ts) via the same `onFrame(frame: PoseFrame)`
 * contract the old mock source used, so the gate/engine/HUD/review code below
 * never had to change.
 *
 * The caller owns what happens with a finished set (solo: save + go to
 * review; workout: save + advance to the next step) via `onPrimaryAction`.
 */
export function ExerciseTracker({
  exercise,
  goal,
  header,
  primaryActionLabel = 'Stop',
  primaryActionIcon = 'stop',
  onPrimaryAction,
}: {
  exercise: Exercise;
  /** Optional rep/hold-time goal — when hit, fires a one-time alert but never
   * stops tracking (the athlete decides when to move on). */
  goal?: ExerciseGoal;
  /** Rendered near the top, e.g. "Step 2 of 5 · Handstand". */
  header?: ReactNode;
  primaryActionLabel?: string;
  primaryActionIcon?: keyof typeof Ionicons.glyphMap;
  onPrimaryAction: (result: ExerciseTrackerResult) => void;
}) {
  const t = useTheme();
  const { mirrorFrontCamera, cameraFacing, repHaptics, hapticCues, repDing, voiceCoach, countdownSec, workoutAlertStyle } =
    useSettings();

  const engine = useMemo(() => new SessionEngine(exercise), [exercise]);

  // Not rendered live anymore (see onFrame) — kept as a ref, not state, since
  // nothing needs a re-render for it. Captured here so a FRESH finish can
  // pass the exact same aspect the live pose pipeline used into the saved
  // session, instead of a second, independently-computed value from the
  // video encoder that can legitimately disagree with it (see finishSet —
  // this is what previously made the review screen's skeleton read as
  // shrunk relative to the body, a scale mismatch, not a position bug).
  const frameAspectRef = useRef<number | null>(null);
  const [live, setLive] = useState<LiveState>({
    reps: 0,
    bestReps: 0,
    holdSeconds: 0,
    bestHoldSeconds: 0,
    attempts: 0,
    activeCue: null,
    activeSeverity: null,
    activeSay: null,
    activeBodyPart: null,
    lastRep: null,
    repMiss: null,
    formQuality: 100,
    cleanReps: 0,
    inPosition: false,
    repThresholds: null,
  });
  const [elapsed, setElapsed] = useState(0);

  // Real-time rep gauge: live elbow-angle marker + target zones. For a
  // hold, or before any adaptive recalibration has happened, this is just
  // the exercise's static declared config. But for an adaptive rep counter
  // (e.g. push-up) that has recalibrated from your own observed range after
  // rep 2, the bar MUST track `live.repThresholds` — the counter's actual
  // current down/up thresholds — or the bar keeps showing the original,
  // now-stale zone while the counter has moved on to different numbers,
  // which is exactly what made a real down→up→down sequence read as "in the
  // green" on the bar while the counter didn't register it.
  const [gaugeMarker, setGaugeMarker] = useState(0);
  const [gaugeVisible, setGaugeVisible] = useState(false);
  const gaugeBounds = useMemo(() => {
    const gauge = exercise.gauge;
    const target = gauge ? Math.min(1, Math.max(0, gauge.target / 180)) : 90 / 180;
    if (live.repThresholds) {
      return {
        down: Math.min(1, Math.max(0, live.repThresholds.downBelow / 180)),
        up: Math.min(1, Math.max(0, live.repThresholds.upAbove / 180)),
        target,
      };
    }
    if (!gauge) return { down: 95 / 180, up: 155 / 180, target };
    return {
      down: Math.min(1, Math.max(0, gauge.downBelow / 180)),
      up: Math.min(1, Math.max(0, gauge.upAbove / 180)),
      target,
    };
  }, [exercise, live.repThresholds]);

  const [phase, setPhase] = useState<Phase>('setup');
  const [fullBody, setFullBody] = useState(false);
  /** True once the athlete has been confirmed (see FACING_MISMATCH_DEBOUNCE_MS)
   * facing the wrong way for this exercise's declared camera view — drives
   * the setup screen's "turn sideways" / "face the camera" message and
   * blocks the countdown, same as fullBody does for framing. */
  const [facingMismatch, setFacingMismatch] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [outOfFrame, setOutOfFrame] = useState(false);
  /** Which of this goal's checkpoints have been passed, in the order they
   * were hit (each announced once, tracking never stops). */
  const [hitCheckpoints, setHitCheckpoints] = useState<number[]>([]);

  const phaseRef = useRef<Phase>('setup');
  const outOfFrameRef = useRef(false);
  /** Frame-time of the last frame where the full body was actually in view —
   * `-Infinity` until the first one, so a flicker can never read as "recently
   * good" before any good frame has happened. */
  const lastFullBodyAtRef = useRef(-Infinity);
  /** Frame-time the facing mismatch started (null while facing is fine or
   * ambiguous) — drives FACING_MISMATCH_DEBOUNCE_MS. */
  const facingMismatchSinceRef = useRef<number | null>(null);
  const trackStartRef = useRef<number | null>(null);
  const lastFrameTRef = useRef(0);
  /** Last whole-second value passed to setElapsed — formatClock() only ever
   * shows whole seconds, so re-rendering on every processed frame (12/sec)
   * when the displayed text changes at most once a second was pure wasted
   * render work. */
  const lastElapsedSecRef = useRef(-1);
  const finalizedRef = useRef(false);
  const prevReps = useRef(0);
  const prevCue = useRef<string | null>(null);
  const hitCheckpointsRef = useRef<Set<number>>(new Set());
  const gaugeMarkerRef = useRef(0);
  const gaugeVisibleRef = useRef(false);
  /** Frame-time the gauge angle last read non-null — used to debounce hiding
   * the bar on brief tracking hiccups (a single dropped frame during fast
   * reps must not make the bar flicker out and back in). */
  const gaugeLastSeenRef = useRef(-Infinity);
  /** Hide the bar only when the angle has been null for this long (ms) —
   * a quick tracking drop recovers well under this; a genuine loss (stepping
   * out of frame, changing exercises...) does not. */
  const GAUGE_HIDE_DEBOUNCE_MS = 500;
  const liveRef = useRef<LiveState | null>(null);
  const landmarksRef = useRef<Landmark[] | null>(null);
  const [liveLandmarks, setLiveLandmarks] = useState<Landmark[] | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Live skeleton overlay: poll landmarks at ~30fps during tracking.
  // Uses a ref→state copy to avoid re-rendering every single frame (60+ fps).
  useEffect(() => {
    if (phase !== 'tracking') { setLiveLandmarks(null); return; }
    const iv = setInterval(() => {
      if (landmarksRef.current) setLiveLandmarks([...landmarksRef.current]);
    }, 33);
    return () => clearInterval(iv);
  }, [phase]);

  // Coach audio: preload the ding + audio session, and silence TTS on exit.
  useEffect(() => {
    initCoachAudio();
    return () => stopCoachAudio();
  }, []);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      if (frame.frameAspect != null) frameAspectRef.current = frame.frameAspect;
      landmarksRef.current = frame.landmarks;

      const fb = bodyInView(frame.landmarks, exercise.requiredJoints, exercise.view, 0.4);
      if (fb) lastFullBodyAtRef.current = frame.t;
      const debouncedFullBody = fb || frame.t - lastFullBodyAtRef.current < FULL_BODY_DEBOUNCE_MS;
      setFullBody(debouncedFullBody);

      // Setup-only: is the athlete facing the wrong way for this exercise's
      // declared camera view? Only a CONFIRMED mismatch (never 'unknown' —
      // an in-between turn or a body not yet fully in frame) starts the
      // debounce clock, so a natural moment of repositioning never flashes
      // the warning.
      if (phaseRef.current === 'setup') {
        const facing = debouncedFullBody ? facingDirection(frame.landmarks) : 'unknown';
        const rawMismatch =
          facing !== 'unknown' &&
          ((exercise.view === 'side' && facing === 'front') || (exercise.view === 'front' && facing === 'side'));
        if (rawMismatch) {
          if (facingMismatchSinceRef.current == null) facingMismatchSinceRef.current = frame.t;
        } else {
          facingMismatchSinceRef.current = null;
        }
        setFacingMismatch(
          facingMismatchSinceRef.current != null &&
            frame.t - facingMismatchSinceRef.current >= FACING_MISMATCH_DEBOUNCE_MS,
        );
      }

      // Real-time rep gauge: update on every tracking frame. During setup
      // the gauge isn't rendered yet (JSX gates on `tracking`), so these
      // state writes only triggered unnecessary React re-renders.
      // Compute exercise angles ONCE per frame — the engine reuses this
      // same record (passing it as precomputedAngles into push()), avoiding
      // the double computation that wasted ~50% of per-frame JS.
      const preAngles = (phaseRef.current === 'tracking') ? exercise.angles(frame.landmarks) : null;
      if (phaseRef.current === 'tracking') {
        const gauge = exercise.gauge;
        if (gauge && preAngles) {
          const val = preAngles[gauge.angle];
          if (val != null) {
            gaugeLastSeenRef.current = frame.t;
            const gv = Math.min(1, Math.max(0, val / 180));
            if (gv !== gaugeMarkerRef.current) { gaugeMarkerRef.current = gv; setGaugeMarker(gv); }
            if (!gaugeVisibleRef.current) { gaugeVisibleRef.current = true; setGaugeVisible(true); }
          } else {
            if (gaugeVisibleRef.current && frame.t - gaugeLastSeenRef.current >= GAUGE_HIDE_DEBOUNCE_MS) {
              gaugeVisibleRef.current = false; setGaugeVisible(false);
            }
          }
        } else {
          if (gaugeVisibleRef.current) { gaugeVisibleRef.current = false; setGaugeVisible(false); }
        }
      }

      if (phaseRef.current !== 'tracking') return;
      if (trackStartRef.current == null) trackStartRef.current = frame.t;
      // Rebased to 0 at the first tracking frame — the SAME real-world
      // instant CameraStage.startRecording() fires (see the effect below),
      // so this lines up with the recorded video's own currentTime. The
      // engine/timeline/segments must use this, not raw frame.t (which is
      // on useCameraPose's clock — running since setup/permission, well
      // before recording starts) — otherwise the review screen's segment
      // seeks and its skeleton-timeline lookup are offset from the video by
      // however long the full-body gate + countdown took, which is exactly
      // what shows up as "the skeleton is frozen for the first few seconds".
      const trackT = frame.t - trackStartRef.current;
      lastFrameTRef.current = trackT;
      const elapsedMs = trackT;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec !== lastElapsedSecRef.current) {
        lastElapsedSecRef.current = elapsedSec;
        setElapsed(elapsedMs);
      }

      // Don't guess when the body isn't fully visible — pause counting + warn.
      // Debounced (see FULL_BODY_DEBOUNCE_MS) so a single flickered frame
      // can't drop a real rep or flash the warning banner on/off.
      if (!debouncedFullBody) {
        if (!outOfFrameRef.current) {
          outOfFrameRef.current = true;
          setOutOfFrame(true);
        }
        return;
      }
      if (outOfFrameRef.current) {
        outOfFrameRef.current = false;
        setOutOfFrame(false);
      }

      // Every tracking frame reaches the counter now — no separate frame-drop
      // gate deciding which ones "count". The live gauge already reflects
      // the exact same angle the counter uses (see gaugeBounds/live.
      // repThresholds above), so a per-frame glitch-rejection layer sitting
      // between the two was the actual bug: whenever it dropped a frame near
      // a fast rep's bottom, the bar (fed every frame, never gated) kept
      // showing the correct down→up→down crossing while the counter silently
      // never saw it. The engine already has its own, more precise defenses
      // against real noise — angles are exponentially smoothed before any
      // gate/rep/form check runs (SessionEngine.smoothAngles), and the
      // counter itself requires a rep's bottom phase to hold for a real
      // MIN_BOTTOM_DWELL_MS before crediting it, so a genuine one-frame
      // teleport still can't manufacture a phantom rep.
      const next = engine.push(frame, trackT, preAngles ?? undefined);
      if (!liveRef.current || liveDiffers(liveRef.current, next)) {
        liveRef.current = next;
        setLive(next);
      }

      // A rep was just completed (guard against attempt resets that drop reps).
      if (next.reps > prevReps.current) {
        if (repHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
        if (repDing) playDing();
      }
      prevReps.current = next.reps;
      if (next.activeCue && next.activeCue !== prevCue.current) {
        if (hapticCues) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        if (voiceCoach) {
          speakCue(next.activeSay ?? next.activeCue, Date.now());
        }
      }
      prevCue.current = next.activeCue;

      // Workout goal: each checkpoint fires once as you pass it, never stops
      // the count — the athlete keeps going and decides when to move on.
      if (goal) {
        const current = goal.type === 'reps' ? next.reps : next.holdSeconds;
        for (const v of goal.values) {
          if (hitCheckpointsRef.current.has(v) || current < v) continue;
          hitCheckpointsRef.current.add(v);
          setHitCheckpoints((prev) => [...prev, v]);
          if (workoutAlertStyle === 'voice') {
            // Say the actual milestone ("30 push-ups"), not the word
            // "checkpoint" — the number is what matters, especially mid-workout
            // with several exercises' announcements back to back.
            const spokenName = exercise.name.replace(/\s*\([^)]*\)/g, '');
            announceGoal(goal.type === 'reps' ? `${v} ${spokenName}s.` : `${v} seconds.`);
          } else {
            tripleBeep();
          }
        }
      }
    },
    [engine, exercise, goal, repHaptics, hapticCues, repDing, voiceCoach, workoutAlertStyle],
  );

  // Full-body gate → facing check → 3-2-1 countdown → tracking.
  useEffect(() => {
    if (phase !== 'setup') return;
    if (!fullBody || facingMismatch) {
      setCountdown(null);
      return;
    }
    const startN = Math.max(1, countdownSec);
    setCountdown(startN);
    let n = startN;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setCountdown(null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        setPhase('tracking');
      } else {
        setCountdown(n);
        Haptics.selectionAsync().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, fullBody, facingMismatch, countdownSec]);

  const finishSet = useCallback(async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    try {
      const summary = engine.summarize(lastFrameTRef.current);
      onPrimaryAction({
        summary,
        timeline: engine.getTimeline(),
        videoUri: null,
        videoAspect: frameAspectRef.current ?? undefined,
      });
    } catch (err) {
      console.error('[ExerciseTracker] finishSet failed:', err);
      finalizedRef.current = false;
      setPhase('tracking');
    }
  }, [engine, onPrimaryAction]);

  const onPrimaryPress = () => {
    if (phase === 'processing') return;
    setPhase('processing');
    finishSet();
  };

  const isHold = exercise.mode === 'hold';
  const metricValue = isHold ? `${live.holdSeconds}s` : String(live.reps);
  const metricLabel = isHold ? 'HOLD' : 'REPS';
  const tracking = phase === 'tracking';
  const goalCurrent = goal ? (goal.type === 'reps' ? live.reps : live.holdSeconds) : 0;
  const sortedGoalValues = goal ? [...goal.values].sort((a, b) => a - b) : [];
  const nextCheckpoint = sortedGoalValues.find((v) => !hitCheckpoints.includes(v));
  const allCheckpointsHit = sortedGoalValues.length > 0 && nextCheckpoint == null;
  const goalProgress = goal ? (nextCheckpoint != null ? Math.min(1, goalCurrent / nextCheckpoint) : 1) : undefined;

  return (
    <View style={styles.root}>
      {/* Camera stage + live skeleton overlay.
          The skeleton is rendered on top of the camera preview at ~30fps
          so you can actually see MediaPipe tracking your body in real time. */}
      <View
        style={styles.stage}
        onLayout={(e) => setStageSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {phase === 'tracking' && liveLandmarks && stageSize.w > 0 ? (
          <View style={styles.skeletonOverlay} pointerEvents="none">
            <SkeletonOverlay
              landmarks={liveLandmarks}
              width={stageSize.w}
              height={stageSize.h}
              frameAspect={frameAspectRef.current}
              mirror={mirrorFrontCamera && cameraFacing === 'front'}
              accentColor={t.accent.color}
              hideLegs={exercise.hideLegs}
              sideView={exercise.view === 'side'}
              showBar={exercise.showBar}
              highlight={live.activeBodyPart as BodyHighlight ?? null}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.topBar} pointerEvents="box-none">
        {header ? <View style={styles.stepHeader}>{header}</View> : null}
        {tracking ? (
          <View style={styles.trackingPill}>
            <View style={[styles.trackingDot, { backgroundColor: t.accent.color }]} />
            <Text variant="caption" style={{ fontWeight: '700' }}>
              Tracking
            </Text>
          </View>
        ) : null}
      </View>

      {/* Full-body gate / facing check / countdown */}
      {phase === 'setup' ? (
        <View style={styles.center} pointerEvents="none">
          {countdown != null ? (
            <Text style={styles.count}>{countdown}</Text>
          ) : facingMismatch ? (
            <View style={styles.gate}>
              <Ionicons name="sync-outline" size={40} color={t.ink.secondary} />
              <Text variant="heading" style={{ textAlign: 'center' }}>
                {exercise.view === 'side' ? 'Turn sideways' : 'Face the camera'}
              </Text>
              <Text tone="secondary" style={{ textAlign: 'center' }}>
                {exercise.view === 'side'
                  ? "This one's tracked from the side — turn so we see your profile, whole body in frame."
                  : "This one's tracked from the front — face the camera directly, whole body in frame."}
              </Text>
            </View>
          ) : (
            <View style={styles.gate}>
              <Ionicons name="scan-outline" size={40} color={t.ink.secondary} />
              <Text variant="heading" style={{ textAlign: 'center' }}>
                Step back
              </Text>
              <Text tone="secondary" style={{ textAlign: 'center' }}>
                Get your whole body in frame to start.
              </Text>
              {exercise.setup ? (
                <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: Spacing.sm }}>
                  {exercise.setup}
                </Text>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* Processing */}
      {phase === 'processing' ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={t.ink.primary} />
          <Text tone="secondary" style={{ marginTop: Spacing.sm }}>
            Analyzing your set…
          </Text>
        </View>
      ) : null}

      {/* Out-of-frame warning */}
      {tracking && outOfFrame ? (
        <View style={styles.warnBanner} pointerEvents="none">
            <View style={[styles.warnPill, { backgroundColor: Feedback.bad }]}>
            <Ionicons name="warning" size={18} color={t.ink.primary} />
        <Text variant="heading" style={{ color: t.ink.primary }}>
                  Get your whole body in frame
                </Text>
              </View>
              <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xs }}>
                Paused — not counting until you&apos;re fully visible.
          </Text>
        </View>
      ) : null}

      {/* HUD — only while tracking */}
      {tracking ? (
        <View style={styles.hud} pointerEvents="box-none">
          <View style={styles.timerWrap}>
            {/* Always shown, even out of frame — the elapsed clock is real
                workout duration (it keeps ticking under the hood regardless;
                see onFrame), so hiding the ring made a running clock LOOK
                stopped, which read as "the app thinks I'm not here" during a
                normal rest. Anchored toward the bottom of this flexible
                region (not vertically centered in it) so it can't drift up
                into the out-of-frame warning banner's space near the top of
                the screen — non-overlap by layout, not by hiding one of them. */}
            <CircularTimer
              label={formatClock(elapsed)}
              // Multi-exercise workouts already name the move in the header
              // pill up top — showing it a second time here was pure repeat.
              sublabel={header ? undefined : exercise.name}
              progress={goalProgress}
              ringColor={allCheckpointsHit ? Feedback.good : formQualityColor(live.formQuality)}
            />
          </View>

          <View style={styles.metric}>
            {/* Plain white, not accent — the live number is read constantly
                during a set, so tinting it green would be exactly the
                "brand color as decoration" mistake already fixed elsewhere.
                The one accented line here is "Best ___" below, a genuine
                callout, same as the mockup's "Personal best" line. */}
            <Text variant="display">{metricValue}</Text>
            <Text variant="label" tone="secondary">
              {metricLabel}
            </Text>
            {goal ? (
              <View style={[styles.goalPill, { borderColor: allCheckpointsHit ? Feedback.good : alpha(t.ink.primary, 0.35) }]}>
                {allCheckpointsHit ? <Ionicons name="checkmark-circle" size={13} color={Feedback.good} /> : null}
                <Text variant="caption" style={{ color: allCheckpointsHit ? Feedback.good : t.ink.primary }}>
                  {sortedGoalValues
                    .map((v) => `${v}${goal.type === 'hold' ? 's' : ''}${hitCheckpoints.includes(v) ? ' ✓' : ''}`)
                    .join(' · ')}
                </Text>
              </View>
            ) : null}
            {(isHold || exercise.gate) && live.attempts > 0 ? (
              <Text variant="caption" tone="accent" style={{ marginTop: 2, fontWeight: '700' }}>
                Best {isHold ? `${live.bestHoldSeconds}s` : live.bestReps} · {live.attempts}{' '}
                {live.attempts === 1 ? 'try' : 'tries'}
              </Text>
            ) : null}
          </View>

          <View style={styles.formRow}>
            <FormBadge quality={live.formQuality} />
            {!isHold && live.reps > 0 ? (
              <Text variant="caption" style={{ marginLeft: Spacing.sm, color: alpha(t.ink.primary, 0.85) }}>
                {live.cleanReps}/{live.reps} clean
              </Text>
            ) : null}
          </View>

          {/* One live fault notification — a rep that just failed to count
              takes priority (most actionable, most specific in the moment),
              otherwise a genuine form violation (not an expected mid-rep
              depth tip), otherwise nothing. */}
          {live.repMiss ? (
            <View style={[styles.badFormBanner, { backgroundColor: Feedback.bad }]}>
              <Ionicons name="warning" size={16} color={t.ink.primary} />
              <Text variant="caption" style={{ color: t.ink.primary }}>
                {live.repMiss}
              </Text>
            </View>
          ) : live.activeCue && live.activeSeverity === 'warn' ? (
            <View style={[styles.badFormBanner, { backgroundColor: Feedback.bad }]}>
              <Ionicons name="warning" size={16} color={t.ink.primary} />
              <Text variant="caption" style={{ color: t.ink.primary }}>
                {live.activeCue}
              </Text>
            </View>
          ) : (
            <View style={styles.cuePlaceholder} />
          )}

          <Pressable
            onPress={onPrimaryPress}
            accessibilityRole="button"
            accessibilityLabel={primaryActionLabel}
            style={[styles.stop, { backgroundColor: t.accent.color }]}
          >
            <Ionicons name={primaryActionIcon} size={22} color={t.accent.onColor} />
            <Text variant="heading" style={{ color: t.accent.onColor }}>
              {primaryActionLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Live gauge — reps get a two-zone depth bar, holds get a traffic-light
          straightness/quality bar centered on the ideal angle. Only once
          you're actually tracking: floating on top of the "step back, get in
          frame" gate screen too was one more thing competing for attention
          before there was anything to gauge yet. */}
      {/* Gated on live.inPosition: the gauge tracking raw angles regardless
          of the exercise gate meant standing arm curls danced a push-up's
          depth bar — the bar appearing is now itself the "you're in
          position, counting is armed" signal. */}
      {tracking ? (
        exercise.mode === 'hold' ? (
          <QualityGauge marker={gaugeMarker} target={gaugeBounds.target} visible={gaugeVisible && live.inPosition} />
        ) : (
          <RepGauge marker={gaugeMarker} down={gaugeBounds.down} up={gaugeBounds.up} visible={gaugeVisible && live.inPosition} />
        )
      ) : null}

      {/* Cancel while setting up */}
      {phase === 'setup' ? (
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.cancel}>
          <Text tone="secondary">Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}


function FormBadge({ quality }: { quality: number }) {
  const color = formQualityColor(quality);
  const label =
    quality >= 70 ? 'Good form'
    : quality >= 40 ? 'Fair form'
    : 'Bad form';
  return (
    <View style={[styles.formBadge, { borderColor: color }]}>
      <View style={[styles.formDot, { backgroundColor: color }]} />
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Surface.base },
  stage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Surface.base },
  skeletonOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  topBar: { position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center', gap: 6 },
  stepHeader: { paddingHorizontal: Spacing.lg, marginBottom: 2 },
  trackingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: alpha(Surface.base, 0.55),
  },
  trackingDot: { width: 7, height: 7, borderRadius: 4 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  gate: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  count: { fontSize: 120, fontWeight: '800', color: Ink.primary, fontVariant: ['tabular-nums'] },
  hud: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: Spacing.xxl, gap: Spacing.lg },
  // flex-end (not 'center') — keeps the timer anchored just above the metric
  // block regardless of how tall this flexible region ends up, so it can
  // never drift up into the out-of-frame warning banner's space near the
  // top of the screen.
  timerWrap: { flex: 1, justifyContent: 'flex-end' },
  metric: { alignItems: 'center' },
  goalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    // Solid-ish backing (like the other floating HUD pills) — a bare border
    // with theme-muted text read fine on a dark app surface but disappeared
    // against a bright/busy live camera background behind it.
    backgroundColor: alpha(Surface.base, 0.55),
  },
  cuePlaceholder: { height: 44 },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
  },
  cancel: { position: 'absolute', bottom: Spacing.xl, alignSelf: 'center', padding: Spacing.md },
  // Independently positioned from topBar (not a sibling in the same flex
  // stack) — kept clear of it with a fixed offset rather than a tight one,
  // since topBar's own height varies with whether a header is present.
  warnBanner: { position: 'absolute', top: 130, left: Spacing.lg, right: Spacing.lg, alignItems: 'center' },
  warnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  formDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badFormBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
});
