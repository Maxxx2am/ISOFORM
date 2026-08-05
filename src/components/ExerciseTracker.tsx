import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircularTimer } from '@/components/CircularTimer';
import { QualityGauge } from '@/components/QualityGauge';
import { RepGauge } from '@/components/RepGauge';
import { Text } from '@/components/Text';
import { bodyInView } from '@/engine/angles';
import { SessionEngine, type LiveState, type SessionSummary, type TimelineSample } from '@/engine/sessionEngine';
import type { Exercise } from '@/exercises/types';
import { announceGoal, initCoachAudio, playDing, stopCoachAudio, tripleBeep } from '@/lib/audio';
import { formatClock } from '@/lib/format';
import { persistBase64Video } from '@/lib/videoStorage';
import { PoseCameraView, type PoseCameraHandle } from '@/pose/PoseCameraView';
import { SkeletonOverlay } from '@/pose/SkeletonOverlay';
import { JOLT_THRESHOLD, MAX_SKIPPED, maxJolt } from '@/pose/stability';
import { usePoseSource } from '@/pose/usePoseSource';
import type { Landmark, PoseFrame } from '@/pose/types';
import { useSettings } from '@/store/settings';
import type { ExerciseGoal } from '@/store/workouts';
import { Feedback, formQualityColor, Radius, Spacing, Surface } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Phase = 'setup' | 'tracking' | 'processing';

export type ExerciseTrackerResult = {
  summary: SessionSummary;
  timeline: TimelineSample[];
  videoUri: string | null;
  videoAspect?: number;
};

/**
 * The single live-tracking view: camera/skeleton stage, full-body gate +
 * countdown, glitch filtering, SessionEngine wiring, gauges, HUD. Shared by
 * the solo `workout/active` screen and the multi-exercise `workout/run`
 * runner so camera/tracking bugfixes only ever need to happen in one place.
 * The caller owns what happens with a finished set (solo: save + go to
 * review; workout: save + advance to the next step) via `onPrimaryAction`.
 */
export function ExerciseTracker({
  exercise,
  goal,
  challenge,
  header,
  primaryActionLabel = 'Stop',
  primaryActionIcon = 'stop',
  onPrimaryAction,
}: {
  exercise: Exercise;
  /** Optional rep/hold-time goal — when hit, fires a one-time alert but never
   * stops tracking (the athlete decides when to move on). */
  goal?: ExerciseGoal;
  /** Daily challenge minimum shown in the live HUD; does not affect counting. */
  challenge?: { mode: string; minimum: number; minimumLabel: string };
  /** Rendered near the top, e.g. "Step 2 of 5 · Handstand". */
  header?: ReactNode;
  primaryActionLabel?: string;
  primaryActionIcon?: keyof typeof Ionicons.glyphMap;
  onPrimaryAction: (result: ExerciseTrackerResult) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { mirrorFrontCamera, repHaptics, repDing, countdownSec, cameraFacing, workoutAlertStyle } =
    useSettings();

  const engine = useMemo(() => new SessionEngine(exercise), [exercise]);
  const camRef = useRef<PoseCameraHandle>(null);

  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [live, setLive] = useState<LiveState>({
    reps: 0,
    totalReps: 0,
    bestReps: 0,
    holdSeconds: 0,
    bestHoldSeconds: 0,
    attempts: 0,
    activeCue: null,
    activeSay: null,
    activeBodyPart: null,
    lastRep: null,
    formQuality: 100,
    cleanReps: 0,
    activeSeverity: null,
    repMiss: null,
    inPosition: false,
    repThresholds: null,
  });
  const [elapsed, setElapsed] = useState(0);

  const [useDemo, setUseDemo] = useState(false);
  const [camStatus, setCamStatus] = useState('Starting');
  const [camReady, setCamReady] = useState(false);
  // The model/camera being "ready" and the WebView's video surface actually
  // being laid out at full size (post navigation-transition) aren't the same
  // moment — the raw `camReady` signal fires a beat before the view visually
  // settles, which read as the camera "starting small then popping to size."
  // Holding the loading screen up a little longer swallows that last flicker.
  const [camVisuallyReady, setCamVisuallyReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const cameraActive = !useDemo && !camError;

  // Real-time rep gauge: live elbow-angle marker + target zones
  const [gaugeMarker, setGaugeMarker] = useState(0);
  const [gaugeDown, setGaugeDown] = useState(95 / 180);
  const [gaugeUp, setGaugeUp] = useState(155 / 180);
  const [gaugeTarget, setGaugeTarget] = useState(90 / 180);
  const [gaugeVisible, setGaugeVisible] = useState(false);

  const [phase, setPhase] = useState<Phase>('setup');
  const [fullBody, setFullBody] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [outOfFrame, setOutOfFrame] = useState(false);
  /** Which of this goal's checkpoints have been passed, in the order they
   * were hit (each announced once, tracking never stops). */
  const [hitCheckpoints, setHitCheckpoints] = useState<number[]>([]);

  const phaseRef = useRef<Phase>('setup');
  const outOfFrameRef = useRef(false);
  const prevGoodRef = useRef<Landmark[] | null>(null);
  const skipCountRef = useRef(0);
  const trackStartRef = useRef<number | null>(null);
  const lastFrameTRef = useRef(0);
  const finalizedRef = useRef(false);
  const backgroundedRef = useRef(false);
  const prevReps = useRef(0);
  const hitCheckpointsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Coach audio: preload the ding + audio session, and silence TTS on exit.
  useEffect(() => {
    initCoachAudio();
    return () => stopCoachAudio();
  }, []);

  useEffect(() => {
    if (!camReady) {
      setCamVisuallyReady(false);
      return;
    }
    const t = setTimeout(() => setCamVisuallyReady(true), 400);
    return () => clearTimeout(t);
  }, [camReady]);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      lastFrameTRef.current = frame.t;
      setLandmarks(frame.landmarks);

      const fb = bodyInView(frame.landmarks, exercise.requiredJoints, exercise.view, 0.4);
      setFullBody(fb);

      // Real-time rep gauge: update on every frame so it shows during setup too.
      const gaugeAngles = exercise.angles(frame.landmarks);
      const gauge = exercise.gauge;
      if (gauge && gaugeAngles) {
        const val = gaugeAngles[gauge.angle];
        if (val != null) {
          setGaugeMarker(Math.min(1, Math.max(0, val / 180)));
          setGaugeDown(Math.min(1, Math.max(0, gauge.downBelow / 180)));
          setGaugeUp(Math.min(1, Math.max(0, gauge.upAbove / 180)));
          setGaugeTarget(Math.min(1, Math.max(0, gauge.target / 180)));
          setGaugeVisible(true);
        } else {
          setGaugeVisible(false);
        }
      } else {
        setGaugeVisible(false);
      }

      if (phaseRef.current !== 'tracking') return;
      if (trackStartRef.current == null) trackStartRef.current = frame.t;
      setElapsed(frame.t - trackStartRef.current);

      // Don't guess when the body isn't fully visible — pause counting + warn.
      if (!fb) {
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

      // Reject glitchy frames (teleporting/flickering skeleton) so they don't
      // count — but only watch the joints THIS exercise cares about (a foot
      // glitch must never reset a push-up streak).
      const prev = prevGoodRef.current;
      if (
        prev &&
        maxJolt(prev, frame.landmarks, exercise.requiredJoints) > JOLT_THRESHOLD &&
        skipCountRef.current < MAX_SKIPPED
      ) {
        skipCountRef.current += 1;
        return;
      }
      skipCountRef.current = 0;
      prevGoodRef.current = frame.landmarks;

      const next = engine.push(frame);
      setLive(next);
      if (next.repThresholds) {
        setGaugeDown(Math.min(1, Math.max(0, next.repThresholds.downBelow / 180)));
        setGaugeUp(Math.min(1, Math.max(0, next.repThresholds.upAbove / 180)));
      }

      // A rep was just completed (guard against attempt resets that drop reps).
      if (next.reps > prevReps.current) {
        if (repHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
        if (repDing) playDing();
      }
      prevReps.current = next.reps;
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
            prevGoodRef.current = null;
          } else {
            tripleBeep();
          }
        }
      }
    },
    [engine, exercise, goal, repHaptics, repDing, workoutAlertStyle],
  );

  usePoseSource({ active: !cameraActive && phase !== 'processing', onFrame });

  // Full-body gate → 3-2-1 countdown → tracking.
  useEffect(() => {
    if (phase !== 'setup') return;
    if (!fullBody) {
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
  }, [phase, fullBody, countdownSec]);

  const finishSet = useCallback(
    (videoUri: string | null, videoAspect?: number) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      const summary = engine.summarize(lastFrameTRef.current);
      onPrimaryAction({ summary, timeline: engine.getTimeline(), videoUri, videoAspect });
    },
    [engine, onPrimaryAction],
  );

  const onVideo = useCallback(
    async (base64: string | null, mime: string, w: number, h: number) => {
      const aspect = w > 0 && h > 0 ? w / h : undefined;
      if (!base64) return finishSet(null);
      try {
        const uri = await persistBase64Video(base64, mime);
        finishSet(uri, aspect);
      } catch {
        finishSet(null);
      }
    },
    [finishSet],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phaseRef.current === 'tracking') {
        backgroundedRef.current = true;
        setPhase('processing');
      } else if (state === 'active' && backgroundedRef.current) {
        backgroundedRef.current = false;
        finishSet(null);
      }
    });
    return () => subscription.remove();
  }, [finishSet]);

  const onPrimaryPress = useCallback(() => {
    if (phase === 'processing') return;
    setPhase('processing');
    if (cameraActive) {
      camRef.current?.finish();
      // Safety net if the video message never arrives.
      setTimeout(() => finishSet(null), 6000);
    } else {
      finishSet(null);
    }
  }, [phase, cameraActive, finishSet]);

  useEffect(() => {
    if (phase !== 'tracking' || !challenge) return;
    const reachedGoal = challenge.mode === 'max-time'
      ? elapsed >= challenge.minimum * 1000
      : challenge.mode === 'rep-target'
        ? live.totalReps >= challenge.minimum
        : challenge.mode === 'hold-target'
          ? live.holdSeconds >= challenge.minimum
          : false;
    if (reachedGoal) onPrimaryPress();
  }, [phase, challenge, elapsed, live.totalReps, live.holdSeconds, onPrimaryPress]);

  const isHold = exercise.mode === 'hold';
  const metricValue = isHold ? `${live.holdSeconds}s` : String(live.reps);
  const metricLabel = isHold ? 'HOLD' : 'REPS';
  const showCamLoader = cameraActive && !camVisuallyReady && phase !== 'processing';
  const tracking = phase === 'tracking';
  const goalCurrent = goal ? (goal.type === 'reps' ? live.reps : live.holdSeconds) : 0;
  const sortedGoalValues = goal ? [...goal.values].sort((a, b) => a - b) : [];
  const nextCheckpoint = sortedGoalValues.find((v) => !hitCheckpoints.includes(v));
  const allCheckpointsHit = sortedGoalValues.length > 0 && nextCheckpoint == null;
  const goalProgress = goal ? (nextCheckpoint != null ? Math.min(1, goalCurrent / nextCheckpoint) : 1) : undefined;
  const challengeCurrent = challenge
    ? challenge.mode === 'max-time'
      ? Math.min(challenge.minimum, Math.floor(elapsed / 1000))
      : isHold
        ? live.holdSeconds
        : live.totalReps
    : 0;
  const challengeRemaining = challenge ? Math.max(0, challenge.minimum - challengeCurrent) : 0;
  const challengeDone = challenge != null && challengeRemaining === 0;

  return (
    <View style={styles.root}>
      {/* Camera / skeleton stage */}
      <View
        style={styles.stage}
        onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {cameraActive ? (
          <PoseCameraView
            ref={camRef}
            facing={cameraFacing}
            hideLegs={!!exercise.hideLegs}
            sideView={exercise.view === 'side'}
            showBar={!!exercise.showBar}
            onFrame={onFrame}
            onStatus={setCamStatus}
            onReady={() => setCamReady(true)}
            onError={setCamError}
            onVideo={onVideo}
          />
        ) : (
          stage.w > 0 && (
            <SkeletonOverlay
              landmarks={landmarks}
              width={stage.w}
              height={stage.h}
              mirror={mirrorFrontCamera}
              accentColor={t.accent.color}
               failColor={live.activeSeverity === 'warn' ? formQualityColor(live.formQuality) : t.accent.color}
               highlight={live.activeSeverity === 'warn' ? live.activeBodyPart as 'torso' | 'arm' | 'leg' | null : null}
              hideLegs={!!exercise.hideLegs}
              sideView={exercise.view === 'side'}
              showBar={!!exercise.showBar}
            />
          )
        )}
      </View>

      {!showCamLoader && phase === 'setup' ? (
        <View pointerEvents="none" style={styles.frameGuide}>
          <View style={styles.frameGuideTop} />
          <View style={styles.frameGuideBottom} />
          <Text variant="label" style={styles.frameGuideLabel}>
            {fullBody ? 'READY' : 'FIT YOUR WHOLE BODY IN FRAME'}
          </Text>
        </View>
      ) : null}

      {/* Top status / mode toggle */}
      <View style={[styles.topBar, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.topLine}>
          {header ? <View style={styles.stepHeader}>{header}</View> : <View style={{ flex: 1 }} />}
          {tracking && (isHold ? live.holdSeconds === 0 && live.attempts === 0 : live.reps === 0) ? (
            <View
              style={[styles.scannerStatus, { borderColor: t.ink.hairline }]}
            >
              <View style={[styles.scannerDot, { backgroundColor: t.ink.muted }]} />
              <Text variant="caption" tone="secondary">No reps yet</Text>
            </View>
          ) : null}
          {__DEV__ ? (
            <Pressable
              onPress={() => {
                if (cameraActive) setUseDemo(true);
                else {
                  setUseDemo(false);
                  setCamError(null);
                  setCamReady(false);
                }
              }}
              style={[styles.chip, { borderColor: t.ink.hairline }]}
            >
              <Ionicons name={cameraActive ? 'videocam' : 'flask'} size={13} color={t.ink.secondary} />
              <Text variant="caption" tone="secondary">{cameraActive ? 'Live camera' : 'Demo mode'} · tap to switch</Text>
            </Pressable>
          ) : null}
        </View>
        {camError ? (
          <Text variant="caption" tone="secondary" style={styles.errText}>
            Camera unavailable ({camError}). Showing demo.
          </Text>
        ) : null}
      </View>

      {/* Camera / model spin-up */}
      {showCamLoader ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={t.ink.primary} />
          <Text tone="secondary" style={{ marginTop: Spacing.sm }}>
            {camStatus || 'Starting'}…
          </Text>
        </View>
      ) : null}

      {/* Full-body gate / countdown */}
      {!showCamLoader && phase === 'setup' ? (
        <View style={styles.setupCenter} pointerEvents="none">
          {countdown != null ? (
            <Text style={styles.count}>{countdown}</Text>
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
              <View style={styles.readinessList}>
                <ReadinessItem icon="sunny-outline" label="Use bright, even lighting" />
                <ReadinessItem icon="phone-portrait-outline" label="Keep the phone stable and upright" />
                <ReadinessItem icon="remove-outline" label="Clear the space around your body" />
              </View>
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
            <Ionicons name="warning" size={18} color="#fff" />
            <Text variant="heading" style={{ color: '#fff' }}>
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
          <View style={[styles.timerWrap, { top: insets.top + 68 }]}>
            <CircularTimer
              label={formatClock(isHold ? live.holdSeconds * 1000 : elapsed)}
              sublabel={exercise.name}
              progress={goalProgress}
              ringColor={allCheckpointsHit ? Feedback.good : formQualityColor(live.formQuality)}
            />
          </View>

          <View
            style={[styles.metric, { bottom: insets.bottom + 88, backgroundColor: 'rgba(0,0,0,0.72)', borderColor: t.ink.hairline }]}
          >
            <Text variant="display" tone="accent">
              {metricValue}
            </Text>
            <Text variant="label" tone="secondary">
              {metricLabel}
            </Text>
            {goal ? (
              <View style={[styles.goalPill, { borderColor: allCheckpointsHit ? Feedback.good : 'rgba(255,255,255,0.35)' }]}>
                {allCheckpointsHit ? <Ionicons name="checkmark-circle" size={13} color={Feedback.good} /> : null}
                <Text variant="caption" style={{ color: allCheckpointsHit ? Feedback.good : '#FFFFFF' }}>
                  {sortedGoalValues
                    .map((v) => `${v}${goal.type === 'hold' ? 's' : ''}${hitCheckpoints.includes(v) ? ' ✓' : ''}`)
                    .join(' · ')}
                </Text>
              </View>
            ) : null}
            {challenge ? (
              <View style={[styles.challengePill, { borderColor: challengeDone ? Feedback.good : 'rgba(255,255,255,0.45)' }]}>
                <Ionicons name={challengeDone ? 'checkmark-circle' : 'trophy-outline'} size={13} color={challengeDone ? Feedback.good : '#FFFFFF'} />
                <Text variant="caption" style={{ color: '#FFFFFF' }}>
                  {challengeDone
                    ? 'Challenge minimum reached'
                    : challenge.mode === 'max-time'
                      ? `${formatClock(challengeRemaining * 1000)} left`
                      : `${challengeRemaining} ${challenge.minimumLabel} to go`}
                </Text>
              </View>
            ) : null}
            {(isHold || exercise.gate) && live.attempts > 0 ? (
              <Text variant="caption" style={{ marginTop: 2, color: 'rgba(255,255,255,0.85)' }}>
                Best {isHold ? `${live.bestHoldSeconds}s` : live.bestReps} · {live.attempts}{' '}
                {live.attempts === 1 ? 'try' : 'tries'}
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={onPrimaryPress}
            style={[styles.stop, { bottom: insets.bottom + 12, borderColor: t.ink.hairline }]}
          >
            <Ionicons name={primaryActionIcon} size={22} color={t.ink.primary} />
            <Text variant="heading">{primaryActionLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Live gauge, always on top: reps get a two-zone depth bar, holds get a
          traffic-light straightness/quality bar centered on the ideal angle. */}
      {exercise.mode === 'hold' ? (
        <QualityGauge marker={gaugeMarker} target={gaugeTarget} visible={gaugeVisible} />
      ) : (
        <RepGauge marker={gaugeMarker} down={gaugeDown} up={gaugeUp} visible={gaugeVisible} />
      )}

      {/* Cancel while setting up */}
      {phase === 'setup' && !showCamLoader ? (
        <Pressable onPress={() => router.back()} style={[styles.cancel, { bottom: insets.bottom + 18 }]}>
          <Text tone="secondary">Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReadinessItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.readinessItem}>
      <Ionicons name={icon} size={14} color="rgba(255,255,255,0.72)" />
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.72)' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Surface.base },
  stage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Surface.base },
  topBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, alignItems: 'stretch', gap: Spacing.sm, zIndex: 4 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  scannerStatus: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  scannerDot: { width: 7, height: 7, borderRadius: 4 },
  stepHeader: { flexShrink: 1, marginRight: Spacing.sm, marginBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexShrink: 1,
  },
  errText: { paddingHorizontal: Spacing.lg, textAlign: 'center' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  setupCenter: { position: 'absolute', top: 0, bottom: 150, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  gate: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl, maxWidth: 360 },
  readinessList: { marginTop: Spacing.md, gap: 5, alignItems: 'flex-start' },
  readinessItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { fontSize: 120, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  hud: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: Spacing.xxl, gap: Spacing.lg },
  timerWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  metric: { position: 'absolute', minWidth: 136, maxWidth: 220, alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 8, borderWidth: 1, borderRadius: Radius.md },
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  challengePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    position: 'absolute',
    alignSelf: 'center',
  },
  cancel: { position: 'absolute', alignSelf: 'center', padding: Spacing.md },
  warnBanner: { position: 'absolute', top: '38%', left: Spacing.lg, right: Spacing.lg, alignItems: 'center' },
  warnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  frameGuide: { position: 'absolute', top: '18%', bottom: '22%', left: '15%', right: '15%', borderColor: 'rgba(255,255,255,0.28)', borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.lg, justifyContent: 'space-between' },
  frameGuideTop: { height: 22, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: 'rgba(130,243,0,0.72)', borderTopLeftRadius: Radius.sm, borderTopRightRadius: Radius.sm },
  frameGuideBottom: { height: 22, borderBottomWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: 'rgba(130,243,0,0.72)', borderBottomLeftRadius: Radius.sm, borderBottomRightRadius: Radius.sm },
  frameGuideLabel: { position: 'absolute', top: -26, alignSelf: 'center', color: 'rgba(255,255,255,0.72)' },
});
