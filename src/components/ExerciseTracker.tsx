import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CircularTimer } from '@/components/CircularTimer';
import { QualityGauge } from '@/components/QualityGauge';
import { RepGauge } from '@/components/RepGauge';
import { Text } from '@/components/Text';
import { bodyInView } from '@/engine/angles';
import { SessionEngine, type LiveState, type SessionSummary, type TimelineSample } from '@/engine/sessionEngine';
import type { Exercise } from '@/exercises/types';
import { announceGoal, initCoachAudio, playDing, speakCue, stopCoachAudio, tripleBeep } from '@/lib/audio';
import { formatClock } from '@/lib/format';
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
  const { mirrorFrontCamera, repHaptics, hapticCues, repDing, voiceCoach, countdownSec, cameraFacing, workoutAlertStyle } =
    useSettings();

  const engine = useMemo(() => new SessionEngine(exercise), [exercise]);
  const camRef = useRef<PoseCameraHandle>(null);

  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [live, setLive] = useState<LiveState>({
    reps: 0,
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

  useEffect(() => () => { if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current); }, []);
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
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevReps = useRef(0);
  const prevCue = useRef<string | null>(null);
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
          // Kicking off TTS can briefly stall frame delivery — forget the
          // last-good pose so the next frame is accepted as a fresh anchor
          // instead of being compared to a now-stale one and misread as a
          // glitch (which silently drops it, eating a rep mid-announcement).
          prevGoodRef.current = null;
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
            prevGoodRef.current = null;
          } else {
            tripleBeep();
          }
        }
      }
    },
    [engine, exercise, goal, repHaptics, hapticCues, repDing, voiceCoach, workoutAlertStyle],
  );

  usePoseSource({ active: !cameraActive && phase !== 'processing', mode: 'mock', onFrame });

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
        const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'mp4';
        const uri = `${FileSystem.cacheDirectory}set-${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        finishSet(uri, aspect);
      } catch {
        finishSet(null);
      }
    },
    [finishSet],
  );

  const onPrimaryPress = () => {
    if (phase === 'processing') return;
    setPhase('processing');
    if (cameraActive) {
      camRef.current?.finish();
      // Safety net if the video message never arrives.
      safetyTimerRef.current = setTimeout(() => finishSet(null), 6000);
    } else {
      finishSet(null);
    }
  };

  const isHold = exercise.mode === 'hold';
  const metricValue = isHold ? `${live.holdSeconds}s` : String(live.reps);
  const metricLabel = isHold ? 'HOLD' : 'REPS';
  const showCamLoader = cameraActive && !camVisuallyReady && phase !== 'processing';
  const tracking = phase === 'tracking';
  const { sortedGoalValues, allCheckpointsHit, goalProgress } = useMemo(() => {
    const current = goal ? (goal.type === 'reps' ? live.reps : live.holdSeconds) : 0;
    const sorted = goal ? [...goal.values].sort((a, b) => a - b) : [];
    const next = sorted.find((v: number) => !hitCheckpoints.includes(v));
    const allHit = sorted.length > 0 && next == null;
    const progress = goal ? (next != null ? Math.min(1, current / next) : 1) : undefined;
    return { sortedGoalValues: sorted, allCheckpointsHit: allHit, goalProgress: progress };
  }, [live.reps, live.holdSeconds, goal, hitCheckpoints]);

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
              failColor={live.activeBodyPart ? formQualityColor(live.formQuality) : t.accent.color}
              highlight={live.activeBodyPart as 'torso' | 'arm' | 'leg' | null}
              hideLegs={!!exercise.hideLegs}
              sideView={exercise.view === 'side'}
              showBar={!!exercise.showBar}
            />
          )
        )}
      </View>

      {/* Top status / mode toggle */}
      <View style={styles.topBar} pointerEvents="box-none">
        {header ? <View style={styles.stepHeader}>{header}</View> : null}
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
          <Text variant="caption" tone="secondary">
            {cameraActive ? 'Live camera' : 'Demo mode'} · tap to switch
          </Text>
        </Pressable>
        {camError ? (
          <View style={[styles.errBox, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
            <Ionicons name="wifi-outline" size={24} color={t.ink.secondary} />
            <Text variant="body" style={{ textAlign: 'center', color: t.ink.primary, marginTop: Spacing.xs }}>
              Connect to Wi-Fi once
            </Text>
            <Text variant="caption" tone="secondary" style={{ textAlign: 'center', marginTop: 4 }}>
              The body tracker needs to download once (~4 MB) before your first workout.
              After that, everything works offline.
            </Text>
          </View>
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
        <View style={styles.center} pointerEvents="none">
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
          <View style={styles.timerWrap}>
            <CircularTimer
              label={formatClock(elapsed)}
              sublabel={exercise.name}
              progress={goalProgress}
              ringColor={allCheckpointsHit ? Feedback.good : formQualityColor(live.formQuality)}
            />
          </View>

          <View style={styles.metric}>
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
            {(isHold || exercise.gate) && live.attempts > 0 ? (
              <Text variant="caption" style={{ marginTop: 2, color: 'rgba(255,255,255,0.85)' }}>
                Best {isHold ? `${live.bestHoldSeconds}s` : live.bestReps} · {live.attempts}{' '}
                {live.attempts === 1 ? 'try' : 'tries'}
              </Text>
            ) : null}
          </View>

          {live.activeCue ? (
            <View style={[styles.cue, { backgroundColor: Feedback.warn }]}>
              <Ionicons name="alert-circle" size={18} color="#000" />
              <Text variant="heading" style={{ color: '#000' }}>
                {live.activeCue}
              </Text>
            </View>
          ) : (
            <View style={styles.cuePlaceholder} />
          )}

          <View style={styles.formRow}>
            <FormBadge quality={live.formQuality} />
            {!isHold && live.reps > 0 ? (
              <Text variant="caption" style={{ marginLeft: Spacing.sm, color: 'rgba(255,255,255,0.85)' }}>
                {live.cleanReps}/{live.reps} clean
              </Text>
            ) : null}
          </View>

          {live.formQuality < 50 && live.reps > 0 ? (
            <View style={[styles.badFormBanner, { backgroundColor: Feedback.bad }]}>
              <Ionicons name="warning" size={16} color="#fff" />
              <Text variant="caption" style={{ color: '#fff' }}>
                Bad form — focus on the cues above
              </Text>
            </View>
          ) : null}

          <Pressable onPress={onPrimaryPress} style={[styles.stop, { borderColor: t.ink.hairline }]}>
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
        <Pressable onPress={() => router.back()} style={styles.cancel}>
          <Text tone="secondary">Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FormBadge({ quality }: { quality: number }) {
  const color =
    quality >= 80 ? Feedback.good
    : quality >= 50 ? Feedback.warn
    : Feedback.bad;
  const label =
    quality >= 80 ? 'Good form'
    : quality >= 50 ? 'Fair form'
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
  topBar: { position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center', gap: 6 },
  stepHeader: { paddingHorizontal: Spacing.lg, marginBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  errBox: { marginHorizontal: Spacing.lg, padding: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', gap: Spacing.xs },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  gate: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  count: { fontSize: 120, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  hud: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: Spacing.xxl, gap: Spacing.lg },
  timerWrap: { flex: 1, justifyContent: 'center' },
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  cuePlaceholder: { height: 44 },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  cancel: { position: 'absolute', bottom: Spacing.xl, alignSelf: 'center', padding: Spacing.md },
  warnBanner: { position: 'absolute', top: 100, left: Spacing.lg, right: Spacing.lg, alignItems: 'center' },
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
