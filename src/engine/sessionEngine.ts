import type { CueSeverity, Exercise } from '@/exercises/types';
import type { Landmark, PoseFrame } from '@/pose/types';
import { FormAnalyzer, type CueTally } from '@/engine/formAnalyzer';
import { AdaptiveRepCounter, type RepEvent } from '@/engine/repCounter';

/** A stored sample for replay: landmarks + which cue (if any) was active. */
export type TimelineSample = {
  t: number;
  landmarks: Landmark[];
  activeCue: string | null;
  /** Rep count in the CURRENT attempt at this exact frame (mirrors
   * LiveState.reps at push time) — lets the review replay show the real
   * count instead of guessing one from elapsed time. Optional: absent on
   * timelines recorded before this field existed. */
  reps?: number;
};

/**
 * A break longer than this (ms) between valid frames ends an attempt.
 * Holds are strict — falling for over half a second IS the end of the hold.
 * Rep streaks are forgiving: a pose glitch or a briefly-lost joint must not
 * reset your set; only genuinely stopping (standing up ≫ 2.5s) closes it.
 */
const HOLD_BREAK_MS = 600;
const REP_BREAK_MS = 4000;
/** Hold-mode gate debounce: a brief gate failure (arm hiding chest in L-sit,
 * a single-frame tracking glitch during a wall sit) must not immediately
 * close the hold. The gate must stay CLOSED this long before the hold
 * actually breaks. The HOLD_BREAK_MS above controls how long the ANGLE can
 * be out of window; this controls how long the GATE can be closed. Together
 * they give a real-world L-sit or handstand genuine forgiveness for a
 * half-second arm/chest overlap without resetting the whole attempt. */
const HOLD_GATE_DEBOUNCE_MS = 600;
/** A hold under this long is a brief flicker into the gate, not a real
 * attempt — it doesn't count toward attempts, best, or the running total.
 * Was 2000 — discarded real 1-2s planche/front-lever progressions. Lowered
 * so beginners working on max-strength statics still get credit. */
const MIN_HOLD_ATTEMPT_MS = 1000;
/**
 * Reps only: the gate must be CONTINUOUSLY held this long before anything
 * counts. Getting into position passes straight through the gate's shape —
 * bending down to the floor for a push-up drops the shoulders (isProne turns
 * true mid-transition) while the arms sweep through a rep-like elbow range,
 * which counted phantom reps and, worse, poisoned the push-up counter's
 * auto-calibration with garbage "reps". A real set has you settled in
 * position well over this long before rep one; transitions don't. Holds are
 * exempt — their clock starting the moment the gate opens IS the feature
 * (and MIN_HOLD_ATTEMPT_MS already discards flickers).
 * Was 800 — raised a bit because the rep counter itself got more sensitive
 * (it now reads the raw, unsmoothed angle so genuinely fast reps stop
 * getting damped out — see SessionEngine.push()'s rawPrimary). That fixed
 * real fast reps not counting, but it also means a brief INCIDENTAL motion
 * during this same settle window (bending down to grab something while
 * resting, not actually starting a set) can now sweep through a full
 * down-up range fast enough to register, where smoothing used to blur it
 * out. A slightly longer settle window is the more surgical fix — it
 * targets the entry transition specifically, without redamping real reps
 * once a set is actually underway.
 */
const REP_GATE_SETTLE_MS = 800;

export type LiveState = {
  /** Reps in the CURRENT attempt (for gated moves like HSPU; total otherwise). */
  reps: number;
  /** Best rep streak across attempts so far. */
  bestReps: number;
  /** Seconds held in the CURRENT attempt (resets to 0 when you fall). */
  holdSeconds: number;
  /** Best single attempt so far, in seconds. */
  bestHoldSeconds: number;
  /** Number of hold attempts started this session. */
  attempts: number;
  activeCue: string | null;
  /** Severity of the active cue — 'warn' is a real fault; 'info' is an
   * expected mid-rep tip (e.g. depth) that shouldn't read as "bad form". */
  activeSeverity: CueSeverity | null;
  /** Fuller phrase for the voice coach (falls back to activeCue). */
  activeSay: string | null;
  /** Body part the active cue targets (for skeleton highlighting). */
  activeBodyPart: string | null;
  lastRep: RepEvent | null;
  /** Set right after an attempt closes on an incomplete rep (went down, never
   * came back up) — brief, specific "why didn't that count" feedback. Clears
   * as soon as a new attempt starts cleanly or a real rep completes. */
  repMiss: string | null;
  /** Overall form quality 0–100 within the current active window. */
  formQuality: number;
  /** How many completed reps had clean form (fewer violations than clean frames). */
  cleanReps: number;
  /** True while the exercise gate is genuinely held (settled, for reps) —
   * i.e. reps/hold-time can actually accrue right now. Drives UI that should
   * only react once you're actually in position (e.g. the live rep gauge —
   * standing arm curls must not move a push-up depth bar). */
  inPosition: boolean;
  /**
   * Reps mode only — the counter's ACTUAL current down/up thresholds,
   * reflecting any adaptive recalibration (e.g. AdaptiveRepCounter re-tunes
   * these from your own observed range after rep 2). The live gauge must
   * read this, not the exercise's static declared config — otherwise the
   * bar keeps showing the ORIGINAL zone forever while the counter has since
   * moved on to different, recalibrated thresholds, so the bar can visually
   * cross into "green" on both ends while the counter — using thresholds the
   * bar no longer reflects — doesn't register a rep. Null for hold-mode
   * exercises, which use exercise.gauge.target instead (no adaptive down/up
   * concept for a hold).
   */
  repThresholds: { downBelow: number; upAbove: number } | null;
};

export type SessionSummary = {
  exerciseId: string;
  mode: 'reps' | 'hold';
  durationMs: number;
  reps: number;
  /** Best single hold attempt, in seconds (the take shown in review). */
  holdSeconds: number;
  /** How many separate attempts were made this session. */
  attempts: number;
  /** Average bottom depth angle across reps (lower = deeper). */
  avgBottomAngle: number | null;
  /** Target angle for the movement (for a depth score). */
  targetAngle: number | null;
  /** Depth score 0..100 — how close to target the average bottom got. */
  depthScore: number | null;
  /** Consistency score 0..100 from rep-to-rep depth variance. */
  consistencyScore: number | null;
  /** Average seconds per rep (tempo). */
  avgRepSeconds: number | null;
  /** Range of motion swept by the primary angle across the set, in degrees. */
  romDegrees: number | null;
  /** Hold form 0..100 from back straightness (best 70% of the hold — forgives a brief wobble). */
  formQuality: number | null;
  /** Sum of every rep-mode attempt's reps this session — survives standing up
   * and resuming, unlike `reps` (which is just the best single streak). */
  totalReps: number;
  /** Sum of every hold attempt's duration this session, in seconds — survives
   * falling and re-holding, unlike `holdSeconds` (just the best attempt). */
  totalHoldSeconds: number;
  /** Sum of every attempt's duration this session, in ms — both modes, rest
   * between attempts excluded by construction (each attempt is one closed
   * contiguous run). This is "time actually training," not wall-clock. */
  activeMs: number;
  cues: CueTally[];
  /** Window of actual work, session-relative ms, for trimming the replay. */
  firstActionMs: number | null;
  lastActionMs: number | null;
  /**
   * Padded playback windows for the review video — one per rep-mode attempt
   * (3s lead-in on the very first, 3s lead-out on the very last, a short
   * ~4s cut between consecutive attempts instead of showing the real gap),
   * or a single best-attempt window for holds. The review screen seeks
   * through these in order on the ONE continuous recorded clip — there's no
   * real multi-clip editing in this stack, so this is what makes a resumed
   * multi-set session play back like a trimmed highlight reel instead of
   * either just the best set or the whole raw recording including the break.
   */
  /**
   * Hold mode: `startMs`/`endMs` include the 3s lead-in/lead-out padding
   * (real video around the hold, not just the hold itself); `realStartMs`/
   * `realEndMs` are the ACTUAL hold boundaries within that padding. The
   * review screen's "Tracking · Xs" badge must count from `realStartMs`, not
   * `startMs` — otherwise it shows several seconds of hold time before the
   * athlete has even gone up, and keeps counting up through the lead-out
   * padding after they've already come down, neither of which matches what
   * actually happened. Reps mode leaves both undefined — its "Tracking"
   * badge already shows the real live rep count, not a derived duration.
   */
  segments: { startMs: number; endMs: number; reps: number; realStartMs?: number; realEndMs?: number }[];
  /**
   * Reps mode only — the counter's FINAL down/up thresholds, same field as
   * LiveState.repThresholds. The review replay's gauge must use this
   * (falling back to the exercise's static declared config only when it's
   * absent, e.g. a session saved before this field existed) instead of
   * always reading the static config directly — otherwise, for an adaptive
   * exercise that recalibrated mid-set, the live bar and the review bar
   * would be drawn against two different zones, one of them already stale.
   * Null for hold-mode exercises, which use exercise.gauge.target instead.
   */
  repThresholds: { downBelow: number; upAbove: number } | null;
};

export class SessionEngine {
  private readonly reps: AdaptiveRepCounter;
  private readonly form: FormAnalyzer;
  private readonly primaryAngle: string;
  private timeline: TimelineSample[] = [];
  private repEvents: RepEvent[] = [];
  // Attempts: maximal runs where the gate holds. Falling/leaving ends one.
  // For holds the score is duration; for gated reps it's the rep streak.
  private attempts: { start: number; end: number; reps: number }[] = [];
  private curStart: number | null = null;
  private curLast = 0;
  private curReps = 0;
  private bestMs = 0;
  private bestRepsSoFar = 0;
  private lastT = 0;
  private startedAt = 0;
  private angleMin = Infinity;
  private angleMax = -Infinity;
  private holdSamples: { t: number; a: number }[] = [];
  private firstActionMs: number | null = null;
  private lastActionMs: number | null = null;
  // Per-rep form tracking: frames and violations since the last rep completed.
  private repFormFrames = 0;
  private repFormViolations = 0;
  private cleanReps = 0;
  private lastRepMiss: string | null = null;
  // Smoothed per-angle state (see smoothAngles below).
  private smoothed: Record<string, number> = {};
  /** Frame-time the gate last transitioned false→true (null while false) —
   * drives the REP_GATE_SETTLE_MS anti-phantom window. */
  private gateSince: number | null = null;
  /** Frame-time the gate last WAS true for a hold exercise — drives
   * HOLD_GATE_DEBOUNCE_MS so a brief gate flicker (arm hiding chest in
   * L-sit) doesn't immediately close the attempt. */
  private holdGateLastTrue = 0;

  state: LiveState = { reps: 0, bestReps: 0, holdSeconds: 0, bestHoldSeconds: 0, attempts: 0, activeCue: null, activeSeverity: null, activeSay: null, activeBodyPart: null, lastRep: null, repMiss: null, formQuality: 100, cleanReps: 0, inPosition: false, repThresholds: null };

  constructor(private readonly exercise: Exercise) {
    this.reps = new AdaptiveRepCounter(exercise.rep ?? { angle: '', downBelow: 0, upAbove: 0 });
    this.form = new FormAnalyzer(exercise);
    this.primaryAngle = exercise.rep?.angle ?? exercise.hold?.angle ?? '';
  }


  /**
   * Light exponential smoothing on the exercise's derived angles. Side-view
   * moves with a near/far leg (L-Sit, pistol, front lever...) can have a
   * limb's visibility flicker right at the threshold frame-to-frame, which
   * makes `symmetricAngle` snap between "both legs averaged" and "one leg
   * only" — a real jump in value even though nothing changed physically.
   * That jump can knock a hold's angle briefly outside its window and reset
   * the attempt, which reads as "it glitches and I never get credit". A true
   * loss of tracking (null) is passed straight through, unsmoothed, so a
   * genuine drop still ends the rep/hold as before.
   */
  private smoothAngles(raw: Record<string, number | null>): Record<string, number | null> {
    const ALPHA = 0.45;
    const out: Record<string, number | null> = {};
    for (const key of Object.keys(raw)) {
      const v = raw[key];
      if (v == null) {
        delete this.smoothed[key];
        out[key] = null;
        continue;
      }
      const prev = this.smoothed[key];
      const next = prev == null ? v : prev + ALPHA * (v - prev);
      this.smoothed[key] = next;
      out[key] = next;
    }
    return out;
  }

  /** Feed one inferred frame, with optional precomputed angles and session-relative trackT
   *  (rebased to 0 at tracking start) to avoid re-computing angles twice
   *  (once for the gauge in ExerciseTracker, once here) and to eliminate the
   *  `{ ...frame, t: trackT }` spread allocation per frame. */
  push(frame: PoseFrame, trackT?: number, precomputedAngles?: Record<string, number | null>): LiveState {
    const t = trackT ?? frame.t;
    if (this.startedAt === 0) this.startedAt = t;
    const rawAngles = precomputedAngles ?? this.exercise.angles(frame.landmarks);
    const angles = this.smoothAngles(rawAngles);
    const ctx = { landmarks: frame.landmarks, angles };

    const rawGateOk = this.exercise.gate ? this.exercise.gate(ctx) : true;
    if (rawGateOk) {
      if (this.gateSince == null) this.gateSince = t;
    } else {
      this.gateSince = null;
    }
    // Reps: the gate only counts once it's been held REP_GATE_SETTLE_MS
    // (see that constant's comment — kills phantom reps from getting into
    // position). Holds keep the raw gate: their clock starting immediately
    // is intended behavior.
    const gateOk =
      rawGateOk &&
      (this.exercise.mode !== 'reps' ||
        frame.t - (this.gateSince ?? t) >= REP_GATE_SETTLE_MS);
    // Only judge form while you're ACTUALLY in the exercise (inverted / prone) —
    // wobble during the kick-up or between reps must never count against you.
    const activeRule = gateOk ? this.form.update(ctx) : null;

    const primary = angles[this.primaryAngle] ?? null;
    if (primary != null) {
      this.angleMin = Math.min(this.angleMin, primary);
      this.angleMax = Math.max(this.angleMax, primary);
    }
    // The counter's own threshold-crossing decision — deliberately the RAW
    // angle (see rawAngles above), not the smoothed `primary`. Exponential
    // smoothing lags real motion: a fast rep that only lasts a frame or two
    // at full depth can get damped down to a fraction of the way there and
    // never actually cross downBelow/upAbove on the smoothed signal, even
    // though the raw angle — and the gauge, which reads it directly — did.
    const rawPrimary = rawAngles[this.primaryAngle] ?? null;

    let lastRep = this.state.lastRep;

    if (this.exercise.mode === 'reps' && this.exercise.rep) {
      if (gateOk) {
        if (this.curStart == null || t - this.curLast > REP_BREAK_MS) {
          if (this.curStart != null) this.closeAttempt();
          this.curStart = t;
          this.curReps = 0;
          this.reps.reset();
          this.repFormFrames = 0;
          this.repFormViolations = 0;
        }
        this.curLast = t;

        // Track per-rep form: how many frames in this rep had violations.
        this.repFormFrames += 1;
        if (activeRule != null && activeRule.severity === 'warn') this.repFormViolations += 1;

        const ev = this.reps.update(rawPrimary, t);
        if (ev) {
          this.repEvents.push(ev);
          this.curReps += 1;
          lastRep = ev;
          this.lastRepMiss = null;
          if (this.firstActionMs == null) this.firstActionMs = ev.t;
          this.lastActionMs = ev.t;
          // Compute form quality for this completed rep.
          if (this.repFormFrames > 0) {
            const repGood = this.repFormFrames - this.repFormViolations;
            if (repGood >= this.repFormViolations) this.cleanReps += 1;
          }
          this.repFormFrames = 0;
          this.repFormViolations = 0;
        } else if (this.reps.consumeShallowMiss()) {
          // Went partway toward the bottom but never reached depth, then
          // came back up — a real attempt, not nothing, so it gets its own
          // reason instead of silently not counting (the counterpart to the
          // "didn't come back up" miss below, closeAttempt()).
          this.lastRepMiss = "Didn't count — go lower, you didn't reach depth";
        }
      } else if (this.curStart != null && t - this.curLast > REP_BREAK_MS) {
        this.closeAttempt();
      }
    } else if (this.exercise.mode === 'hold' && this.exercise.hold) {
      const a = rawAngles[this.exercise.hold.angle];
      const rawValid = gateOk && a != null && a >= this.exercise.hold.minOk && a <= this.exercise.hold.maxOk;
      // Debounce gate closing for holds — a half-second tracking glitch
      // (arm hiding chest in L-sit, brief landmark loss in handstand) must
      // not reset the entire attempt.
      if (rawGateOk) this.holdGateLastTrue = frame.t;
      const gateDebounced = frame.t - this.holdGateLastTrue < HOLD_GATE_DEBOUNCE_MS;
      const valid = (gateOk || gateDebounced) && a != null && a >= this.exercise.hold.minOk && a <= this.exercise.hold.maxOk;
      if (valid) {
        if (this.curStart == null || t - this.curLast > HOLD_BREAK_MS) {
          if (this.curStart != null) this.closeAttempt();
          this.curStart = t;
        }
        this.curLast = t;
        if (a != null) this.holdSamples.push({ t, a });
      } else if (this.curStart != null && t - this.curLast > HOLD_BREAK_MS) {
        this.closeAttempt();
      }
    }
    this.lastT = t;

    this.timeline.push({ t, landmarks: frame.landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility })), activeCue: activeRule?.cue ?? null, reps: this.curReps });

    const curMs = this.curStart != null ? this.curLast - this.curStart : 0;
    this.state = {
      reps: this.curReps,
      bestReps: Math.max(this.bestRepsSoFar, this.curReps),
      holdSeconds: Math.floor(curMs / 1000),
      bestHoldSeconds: Math.floor(Math.max(this.bestMs, curMs) / 1000),
      attempts: this.attempts.length + (this.curStart != null ? 1 : 0),
      activeCue: activeRule?.cue ?? null,
      activeSeverity: activeRule?.severity ?? null,
      activeSay: activeRule ? (activeRule.say ?? activeRule.cue) : null,
      activeBodyPart: activeRule?.bodyPart ?? null,
      lastRep,
      repMiss: this.lastRepMiss,
      formQuality: this.form.getFormQuality(),
      cleanReps: this.cleanReps,
      inPosition: gateOk,
      repThresholds: this.exercise.mode === 'reps' && this.exercise.rep ? this.reps.getThresholds() : null,
    };
    return this.state;
  }

  /**
   * Padded per-attempt playback windows for the review video (see the
   * `segments` field's doc comment on SessionSummary for the full spec).
   * Holds: a single window around the best attempt (unchanged behavior,
   * just expressed in the shared shape). Reps: one window per attempt that
   * actually completed a rep, 3s lead-in/lead-out on the first/last, ~2s+2s
   * at each join — clamped to the real gap's midpoint so a short real gap
   * (attempts must be at least REP_BREAK_MS apart already) never produces
   * overlapping or inverted windows.
   */
  private buildReplaySegments(
    best: { start: number; end: number; reps: number } | null,
  ): { startMs: number; endMs: number; reps: number; realStartMs?: number; realEndMs?: number }[] {
    const PAD_END_MS = 3000;
    /** Half of the total cut shown at a join between two attempts (1.5s
     * after the previous attempt's end + 1.5s before the next one's start =
     * 3s combined) — a short jump-cut instead of showing the real rest gap
     * between sets, which can run minutes long. */
    const PAD_JOIN_MS = 1500;

    if (this.exercise.mode === 'hold') {
      if (!best) return [];
      return [{
        startMs: Math.max(0, best.start - PAD_END_MS),
        endMs: best.end + PAD_END_MS,
        reps: 0,
        realStartMs: best.start,
        realEndMs: best.end,
      }];
    }

    const repAttempts = this.attempts.filter((a) => a.reps > 0);
    const segments: { startMs: number; endMs: number; reps: number }[] = [];
    for (let i = 0; i < repAttempts.length; i++) {
      const a = repAttempts[i];
      const isFirst = i === 0;
      const isLast = i === repAttempts.length - 1;
      let startMs = Math.max(0, a.start - (isFirst ? PAD_END_MS : PAD_JOIN_MS));
      const endMs = a.end + (isLast ? PAD_END_MS : PAD_JOIN_MS);
      if (!isFirst) {
        const prev = repAttempts[i - 1];
        const gapMid = (prev.end + a.start) / 2;
        startMs = Math.max(startMs, gapMid);
        segments[i - 1].endMs = Math.min(segments[i - 1].endMs, gapMid);
      }
      segments.push({ startMs, endMs, reps: a.reps });
    }
    return segments;
  }

  private closeAttempt() {
    if (this.curStart == null) return;
    // Negatives: bailing at the bottom still completes the eccentric rep.
    if (this.exercise.mode === 'reps' && this.exercise.countEccentric && this.reps.flush()) {
      this.curReps += 1;
    } else if (this.exercise.mode === 'reps' && this.reps.isPending()) {
      // Went down (crossed the bottom threshold) but the attempt ended
      // before coming back up — that rep never completed.
      this.lastRepMiss = "Didn't count — go all the way back up";
    }
    const attempt = { start: this.curStart, end: this.curLast, reps: this.curReps };
    const durationMs = attempt.end - attempt.start;
    // A hold under MIN_HOLD_ATTEMPT_MS is a brief flicker into the gate, not
    // a real attempt — don't let it count toward attempts/best/total.
    const countsAsAttempt = this.exercise.mode !== 'hold' || durationMs >= MIN_HOLD_ATTEMPT_MS;
    if (countsAsAttempt) {
      this.attempts.push(attempt);
      this.bestMs = Math.max(this.bestMs, durationMs);
      this.bestRepsSoFar = Math.max(this.bestRepsSoFar, attempt.reps);
    }
    this.form.reset();
    this.curStart = null;
    this.curReps = 0;
    this.repFormFrames = 0;
    this.repFormViolations = 0;
  }

  /** Best attempt: most reps for rep exercises, longest run for holds.
   *  When tied on reps/duration, picks the LATEST (most recent) attempt —
   *  the athlete is usually better and more warmed up later in the set. */
  private bestAttempt(): { start: number; end: number; reps: number } | null {
    const byReps = this.exercise.mode === 'reps';
    let best: { start: number; end: number; reps: number } | null = null;
    for (const a of this.attempts) {
      if (!best) { best = a; continue; }
      const aScore = byReps ? a.reps : a.end - a.start;
      const bestScore = byReps ? best.reps : best.end - best.start;
      // Strictly greater: new best. Equally good but later: also take it
      // (later in the session = warmer, more practiced).
      if (aScore >= bestScore) best = a;
    }
    return best;
  }

  getTimeline(): TimelineSample[] {
    return this.timeline;
  }

  summarize(endT: number): SessionSummary {
    const bottoms = this.repEvents.map((r) => r.bottomAngle);
    const avgBottomAngle = bottoms.length ? mean(bottoms) : null;
    const target = this.exercise.targetAngle ?? null;

    // Depth: how close the average bottom got to the target (contracted) angle.
    let depthScore: number | null = null;
    if (avgBottomAngle != null && target != null) {
      const err = Math.abs(avgBottomAngle - target);
      depthScore = Math.max(0, Math.round(100 - err * 1.5));
    }

    // Consistency: tighter rep-to-rep depth spread = higher score.
    let consistencyScore: number | null = null;
    if (bottoms.length >= 2) {
      const sd = stddev(bottoms);
      consistencyScore = Math.max(0, Math.round(100 - sd * 3));
    }

    let avgRepSeconds: number | null = null;
    if (this.repEvents.length >= 2) {
      const span = this.repEvents[this.repEvents.length - 1].t - this.repEvents[0].t;
      avgRepSeconds = Math.round((span / (this.repEvents.length - 1) / 1000) * 10) / 10;
    }

    const rom = this.angleMax > this.angleMin ? Math.round(this.angleMax - this.angleMin) : null;

    // Close the final attempt and keep the BEST one — the review and replay
    // window are built around it (best hold, or best rep streak for gated reps).
    this.closeAttempt();
    const totalReps = this.exercise.mode === 'reps' ? this.attempts.reduce((s, a) => s + a.reps, 0) : 0;
    const totalHoldSeconds =
      this.exercise.mode === 'hold'
        ? Math.round(this.attempts.reduce((s, a) => s + (a.end - a.start), 0) / 1000)
        : 0;
    const activeMs = this.attempts.reduce((s, a) => s + (a.end - a.start), 0);
    let firstActionMs = this.firstActionMs;
    let lastActionMs = this.lastActionMs;
    let bestHoldSeconds = 0;
    let reps = this.repEvents.length;
    const best = this.bestAttempt();
    if (best) {
      if (this.exercise.mode === 'hold') {
        bestHoldSeconds = Math.round((best.end - best.start) / 1000);
        firstActionMs = best.start;
        lastActionMs = best.end;
      } else {
        reps = best.reps;
        if (this.exercise.gate) {
          firstActionMs = best.start;
          lastActionMs = best.end;
        }
      }
    }

    // Hold form quality: straightness over the BEST attempt, keeping only the
    // best 70% of frames so a brief early wobble doesn't drag it down.
    let formQuality: number | null = null;
    if (this.exercise.mode === 'hold' && best) {
      const ideal = target ?? 180;
      const devs = this.holdSamples
        .filter((s) => s.t >= best.start && s.t <= best.end)
        .map((s) => Math.abs(ideal - s.a));
      if (devs.length > 0) {
        devs.sort((a, b) => a - b);
        const keep = Math.max(1, Math.ceil(devs.length * 0.7));
        const avgDev = mean(devs.slice(0, keep));
        formQuality = Math.max(0, Math.min(100, Math.round(100 - avgDev * 2)));
      }
    }

    const segments = this.buildReplaySegments(best);

    return {
      exerciseId: this.exercise.id,
      mode: this.exercise.mode,
      durationMs: this.startedAt ? endT - this.startedAt : 0,
      reps,
      holdSeconds: bestHoldSeconds,
      attempts: this.attempts.length,
      avgBottomAngle,
      targetAngle: target,
      depthScore,
      consistencyScore,
      avgRepSeconds,
      romDegrees: rom,
      formQuality,
      segments,
      totalReps,
      totalHoldSeconds,
      activeMs,
      cues: this.form.report(),
      firstActionMs,
      lastActionMs,
      repThresholds: this.exercise.mode === 'reps' && this.exercise.rep ? this.reps.getThresholds() : null,
    };
  }
}

/**
 * The single source of truth for the review score. Reflects what you DID, not
 * whether you obeyed cues: holds score on back straightness + time held; reps
 * on depth + consistency + count. No cue penalty.
 */
export function scoreSession(s: SessionSummary): number {
  const didNothing = s.mode === 'hold' ? s.holdSeconds === 0 : s.reps === 0;
  if (didNothing) return 0;
  const parts: number[] = [];
  if (s.mode === 'hold') {
    if (s.formQuality != null) parts.push(s.formQuality);
    // 20s = 100pts (full marks). Past 20s, logarithmic scaling so 60s ≈ 120,
    // 120s ≈ 130 — rewards longer holds without flattening progression.
    parts.push(Math.round(Math.min(130, 100 + 20 * Math.log2(Math.max(1, s.holdSeconds / 20)))));
  } else {
    if (s.depthScore != null) parts.push(s.depthScore);
    if (s.consistencyScore != null) parts.push(s.consistencyScore);
    // 12 reps = 100pts. Past 12, logarithmic scaling so 50 reps ≈ 120+.
    parts.push(Math.round(Math.min(130, 100 + 20 * Math.log2(Math.max(1, s.reps / 12)))));
  }
  return parts.length ? Math.round(mean(parts)) : 0;
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
}
