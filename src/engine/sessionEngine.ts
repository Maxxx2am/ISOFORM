import type { Exercise } from '@/exercises/types';
import type { Landmark, PoseFrame } from '@/pose/types';
import { FormAnalyzer, type CueTally } from '@/engine/formAnalyzer';
import { AdaptiveRepCounter, RepCounter, type RepEvent } from '@/engine/repCounter';

/** A stored sample for replay: landmarks + which cue (if any) was active. */
export type TimelineSample = {
  t: number;
  landmarks: Landmark[];
  activeCue: string | null;
};

/**
 * A break longer than this (ms) between valid frames ends an attempt.
 * Holds are strict — falling for over half a second IS the end of the hold.
 * Rep streaks are forgiving: a pose glitch or a briefly-lost joint must not
 * reset your set; only genuinely stopping (standing up ≫ 2.5s) closes it.
 */
const HOLD_BREAK_MS = 600;
const REP_BREAK_MS = 2500;

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
  /** Fuller phrase for the voice coach (falls back to activeCue). */
  activeSay: string | null;
  /** Body part the active cue targets (for skeleton highlighting). */
  activeBodyPart: string | null;
  lastRep: RepEvent | null;
  /** Overall form quality 0–100 within the current active window. */
  formQuality: number;
  /** How many completed reps had clean form (fewer violations than clean frames). */
  cleanReps: number;
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
  cues: CueTally[];
  /** Window of actual work, session-relative ms, for trimming the replay. */
  firstActionMs: number | null;
  lastActionMs: number | null;
};

export class SessionEngine {
  private readonly reps: RepCounter | AdaptiveRepCounter;
  private readonly form: FormAnalyzer;
  private readonly primaryAngle: string;
  private readonly isAdaptive: boolean;
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
  // Smoothed per-angle state (see smoothAngles below).
  private smoothed: Record<string, number> = {};

  state: LiveState = { reps: 0, bestReps: 0, holdSeconds: 0, bestHoldSeconds: 0, attempts: 0, activeCue: null, activeSay: null, activeBodyPart: null, lastRep: null, formQuality: 100, cleanReps: 0 };

  constructor(private readonly exercise: Exercise) {
    this.reps = exercise.slug === 'pushup'
      ? new AdaptiveRepCounter(exercise.rep ?? { angle: '', downBelow: 0, upAbove: 0 })
      : new RepCounter(exercise.rep ?? { angle: '', downBelow: 0, upAbove: 0 });
    this.form = new FormAnalyzer(exercise);
    this.primaryAngle = exercise.rep?.angle ?? exercise.hold?.angle ?? '';
    this.isAdaptive = exercise.slug === 'pushup';
  }

  /** Current rep thresholds (calibrated for push-ups). Used by the gauge. */
  getThresholdInfo(): { downBelow: number; upAbove: number } {
    return this.reps.getThresholds();
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

  /** Feed one inferred frame. */
  push(frame: PoseFrame): LiveState {
    if (this.startedAt === 0) this.startedAt = frame.t;
    const angles = this.smoothAngles(this.exercise.angles(frame.landmarks));
    const ctx = { landmarks: frame.landmarks, angles };

    const gateOk = this.exercise.gate ? this.exercise.gate(ctx) : true;
    // Only judge form while you're ACTUALLY in the exercise (inverted / prone) —
    // wobble during the kick-up or between reps must never count against you.
    const activeRule = gateOk ? this.form.update(ctx) : null;

    const primary = angles[this.primaryAngle] ?? null;
    if (primary != null) {
      this.angleMin = Math.min(this.angleMin, primary);
      this.angleMax = Math.max(this.angleMax, primary);
    }

    let lastRep = this.state.lastRep;

    if (this.exercise.mode === 'reps' && this.exercise.rep) {
      if (gateOk) {
        if (this.curStart == null || frame.t - this.curLast > REP_BREAK_MS) {
          if (this.curStart != null) this.closeAttempt();
          this.curStart = frame.t;
          this.curReps = 0;
          this.reps.reset();
          this.repFormFrames = 0;
          this.repFormViolations = 0;
        }
        this.curLast = frame.t;

        // Track per-rep form: how many frames in this rep had violations.
        // Only a `warn`-severity active rule counts as a real violation here
        // (same reasoning as FormAnalyzer.update) — an `info` depth tip mid-
        // rep is expected geometry, not a fault, and shouldn't mark an
        // otherwise-clean rep as unclean in the "X/Y clean reps" count.
        this.repFormFrames += 1;
        if (activeRule != null && activeRule.severity === 'warn') this.repFormViolations += 1;

        const ev = this.reps.update(primary, frame.t);
        if (ev) {
          this.repEvents.push(ev);
          this.curReps += 1;
          lastRep = ev;
          if (this.firstActionMs == null) this.firstActionMs = ev.t;
          this.lastActionMs = ev.t;
          // Compute form quality for this completed rep.
          if (this.repFormFrames > 0) {
            const repGood = this.repFormFrames - this.repFormViolations;
            if (repGood >= this.repFormViolations) this.cleanReps += 1;
          }
          this.repFormFrames = 0;
          this.repFormViolations = 0;
        }
      } else if (this.curStart != null && frame.t - this.curLast > REP_BREAK_MS) {
        this.closeAttempt();
      }
    } else if (this.exercise.mode === 'hold' && this.exercise.hold) {
      const a = angles[this.exercise.hold.angle];
      const valid = gateOk && a != null && a >= this.exercise.hold.minOk && a <= this.exercise.hold.maxOk;
      if (valid) {
        // Start a fresh attempt after a break (>0.6s since the last valid frame).
        if (this.curStart == null || frame.t - this.curLast > HOLD_BREAK_MS) {
          if (this.curStart != null) this.closeAttempt();
          this.curStart = frame.t;
        }
        this.curLast = frame.t;
        // Sample the hold angle for the form score — geometry (how close to the
        // ideal shape), not whether cues were followed.
        if (a != null) this.holdSamples.push({ t: frame.t, a });
      } else if (this.curStart != null && frame.t - this.curLast > HOLD_BREAK_MS) {
        this.closeAttempt();
      }
    }
    this.lastT = frame.t;

    this.timeline.push({ t: frame.t, landmarks: frame.landmarks, activeCue: activeRule?.cue ?? null });

    const curMs = this.curStart != null ? this.curLast - this.curStart : 0;
    this.state = {
      reps: this.curReps,
      bestReps: Math.max(this.bestRepsSoFar, this.curReps),
      holdSeconds: Math.floor(curMs / 1000),
      bestHoldSeconds: Math.floor(Math.max(this.bestMs, curMs) / 1000),
      attempts: this.attempts.length + (this.curStart != null ? 1 : 0),
      activeCue: activeRule?.cue ?? null,
      activeSay: activeRule ? (activeRule.say ?? activeRule.cue) : null,
      activeBodyPart: activeRule?.bodyPart ?? null,
      lastRep,
      formQuality: this.form.getFormQuality(),
      cleanReps: this.cleanReps,
    };
    return this.state;
  }

  private closeAttempt() {
    if (this.curStart == null) return;
    // Negatives: bailing at the bottom still completes the eccentric rep.
    if (this.exercise.mode === 'reps' && this.exercise.countEccentric && this.reps.flush()) {
      this.curReps += 1;
    }
    const attempt = { start: this.curStart, end: this.curLast, reps: this.curReps };
    this.attempts.push(attempt);
    this.bestMs = Math.max(this.bestMs, attempt.end - attempt.start);
    this.bestRepsSoFar = Math.max(this.bestRepsSoFar, attempt.reps);
    this.curStart = null;
    this.curReps = 0;
    this.repFormFrames = 0;
    this.repFormViolations = 0;
  }

  /** Best attempt: most reps for rep exercises, longest run for holds. */
  private bestAttempt(): { start: number; end: number; reps: number } | null {
    const byReps = this.exercise.mode === 'reps';
    let best: { start: number; end: number; reps: number } | null = null;
    for (const a of this.attempts) {
      if (!best) best = a;
      else if (byReps ? a.reps > best.reps : a.end - a.start > best.end - best.start) best = a;
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
      cues: this.form.report(),
      firstActionMs,
      lastActionMs,
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
    parts.push(Math.min(100, Math.round((s.holdSeconds / 20) * 100))); // 20s ≈ full marks
  } else {
    if (s.depthScore != null) parts.push(s.depthScore);
    if (s.consistencyScore != null) parts.push(s.consistencyScore);
    parts.push(Math.min(100, Math.round((s.reps / 12) * 100)));
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
