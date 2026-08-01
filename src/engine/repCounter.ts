import type { RepConfig } from '@/exercises/types';

type Phase = 'top' | 'bottom';

/**
 * A real rep's contracted phase takes real time — a single noisy frame that
 * dips below threshold and immediately bounces back (angle-estimation
 * jitter, not a real movement) crosses back up faster than this, so it's
 * filtered out instead of crediting a rep for a micro-movement that was
 * never a rep. Was 120ms — but the live tracker samples at ~15fps (a ~67ms
 * nominal gap between frames), so a genuinely fast rep touched by just ONE
 * accepted frame at the bottom before reversing has a measured dwell of
 * roughly one frame interval, comfortably UNDER 120ms — meaning a completely
 * real fast rep (confirmed: the bar visibly hit the green bottom zone, then
 * the green top zone) still got silently rejected as "noise" here, even
 * after the frame-drop gate between the gauge and the counter was removed.
 * Lowered well below one nominal frame interval so any real single-frame
 * touch survives; a same-instant duplicate/glitch reading (near-zero ms)
 * still doesn't.
 */
const MIN_BOTTOM_DWELL_MS = 60;

/** How far into the down↔up window (as a fraction, from the bottom) counts as
 * "genuinely went for it" rather than just resting near the top. */
const SHALLOW_APPROACH_FRACTION = 0.25;
/** Same noise-spike reasoning as MIN_BOTTOM_DWELL_MS, applied to a shallow
 * dip instead of a full rep — a real attempt that fell short still takes a
 * moment, unlike a single noisy frame. */
const MIN_APPROACH_DWELL_MS = 150;

/**
 * Detects "went partway down but never reached depth, then came back up" —
 * a real attempt at a rep that fell short, distinct from just resting near
 * the top. Shared by RepCounter and AdaptiveRepCounter (identical top-phase
 * logic in both) so the "didn't go low enough" feedback works the same way
 * for every rep-mode exercise via its own existing rep config — no
 * per-exercise code.
 */
class ShallowMissTracker {
  private approaching = false;
  private approachEnteredAt = 0;
  private missed = false;

  /** Call every frame while in the 'top' phase and NOT crossing into
   * 'bottom' this frame. */
  track(angle: number, t: number, downBelow: number, upAbove: number) {
    const zoneHigh = downBelow + (upAbove - downBelow) * SHALLOW_APPROACH_FRACTION;
    if (angle < zoneHigh) {
      if (!this.approaching) {
        this.approaching = true;
        this.approachEnteredAt = t;
      }
    } else if (this.approaching) {
      if (t - this.approachEnteredAt >= MIN_APPROACH_DWELL_MS) this.missed = true;
      this.approaching = false;
    }
  }

  /** True once right after a shortfall, then clears — an edge-triggered
   * event like a RepEvent, not a persistent status. */
  consume(): boolean {
    const v = this.missed;
    this.missed = false;
    return v;
  }

  reset() {
    this.approaching = false;
    this.approachEnteredAt = 0;
    this.missed = false;
  }
}

export type RepEvent = {
  index: number;
  /** ms timestamp (session-relative) the rep completed. */
  t: number;
  /** Deepest angle reached during the rep — a depth/quality proxy. */
  bottomAngle: number;
};

/**
 * Adaptive rep counter that auto-calibrates thresholds from your first few reps.
 * Perfect for push-ups where hand width changes the elbow angle range.
 */
export class AdaptiveRepCounter {
  private phase: Phase = 'top';
  private bottomAngle = 180;
  private bottomEnteredAt = 0;
  private observedMin = 180;
  private observedMax = 0;
  private calibrationReps = 0;
  private calibratedDownBelow: number;
  private calibratedUpAbove: number;
  private shallow = new ShallowMissTracker();
  count = 0;

  constructor(private readonly cfg: RepConfig) {
    // Seed calibration from the exercise's own declared thresholds instead of
    // fixed literals — the first couple of reps still refine these from
    // observed min/max (below), but starting from the exercise's real config
    // means push-up's gauge and its rep counter agree from rep one, and a
    // registry override of downBelow/upAbove actually takes effect.
    this.calibratedDownBelow = cfg.downBelow;
    this.calibratedUpAbove = cfg.upAbove;
  }

  /** Feed a frame's primary angle. Returns a RepEvent when a rep completes. */
  update(angle: number | null, t: number): RepEvent | null {
    if (angle == null) return null;

    // Phase 1-2: Learn the actual range of motion
    if (this.calibrationReps < 3) {
      // Clamp to biomechanically plausible joint angles — a MediaPipe glitch
      // (visibility flicker, landmark teleport) can briefly read 0° or 180°
      // even while the athlete is mid-rep. Feeding those into the calibration
      // range permanently poisons the adaptive thresholds (e.g., observedMin=0
      // makes downBelow unreachable). Clamp at 10°–175° to reject these.
      const clamped = Math.max(10, Math.min(175, angle));
      this.observedMin = Math.min(this.observedMin, clamped);
      this.observedMax = Math.max(this.observedMax, clamped);

      if (this.phase === 'bottom' && angle > (this.calibratedUpAbove || this.cfg.upAbove)) {
        // Bounced back up too fast to have been a real rep — a noise spike,
        // not a movement. Don't credit it, don't burn a calibration slot.
        if (t - this.bottomEnteredAt < MIN_BOTTOM_DWELL_MS) {
          this.phase = 'top';
          this.bottomAngle = 180;
          return null;
        }

        this.calibrationReps += 1;
        this.count += 1;
        const event: RepEvent = { index: this.count, t, bottomAngle: this.bottomAngle };
        this.phase = 'top';
        this.bottomAngle = 180;

        // After 2 reps, set adaptive thresholds
        if (this.calibrationReps >= 2) {
          const range = this.observedMax - this.observedMin;
          this.calibratedDownBelow = this.observedMin + Math.min(15, range * 0.4);
          this.calibratedUpAbove = this.observedMax - Math.min(10, range * 0.2);
        }

        if (this.calibrationReps >= 3) {
          this.calibrationReps = 3; // Cap at 3
        }

        return event;
      }

      if (this.phase === 'top') {
        if (angle < this.calibratedDownBelow) {
          this.phase = 'bottom';
          this.bottomAngle = angle;
          this.bottomEnteredAt = t;
        } else {
          this.shallow.track(angle, t, this.calibratedDownBelow, this.calibratedUpAbove);
        }
      }
      return null;
    }

    // Phase 3+: Use adaptive thresholds, but keep tracking range for
    // periodic recalibration — a warm-up set often deepens as you go, and
    // walking closer/further from the camera changes the observed range.
    const d = this.calibratedDownBelow;
    const u = this.calibratedUpAbove;

    // Track the full observed range on every frame, both phases — so
    // recalibration has continuously fresh data even if the athlete moves
    // closer/further or changes hand position mid-set.
    const clamped = Math.max(10, Math.min(175, angle));
    this.observedMin = Math.min(this.observedMin, clamped);
    this.observedMax = Math.max(this.observedMax, clamped);

    if (this.phase === 'top') {
      if (angle < d) {
        this.phase = 'bottom';
        this.bottomAngle = angle;
        this.bottomEnteredAt = t;
      } else {
        this.shallow.track(angle, t, d, u);
      }
      return null;
    }

    // phase === 'bottom'
    this.bottomAngle = Math.min(this.bottomAngle, angle);
    if (angle > u) {
      this.phase = 'top';
      if (t - this.bottomEnteredAt < MIN_BOTTOM_DWELL_MS) {
        this.bottomAngle = 180;
        return null;
      }
      this.count += 1;
      const event: RepEvent = { index: this.count, t, bottomAngle: this.bottomAngle };

      // Recalibrate every 3 reps (was 5) — a new position/distance changes
      // the observed range quickly, and a fresh calibration catches it sooner.
      if (this.count % 3 === 0) {
        const range = this.observedMax - this.observedMin;
        if (range > 8) {
          this.calibratedDownBelow = this.observedMin + Math.min(15, range * 0.4);
          this.calibratedUpAbove = this.observedMax - Math.min(10, range * 0.2);
        }
      }

      this.bottomAngle = 180;
      return event;
    }
    return null;
  }

  reset() {
    this.phase = 'top';
    this.bottomAngle = 180;
    this.bottomEnteredAt = 0;
    this.observedMin = 180;
    this.observedMax = 0;
    this.calibrationReps = 0;
    this.calibratedDownBelow = this.cfg.downBelow;
    this.calibratedUpAbove = this.cfg.upAbove;
    this.shallow.reset();
    this.count = 0;
  }

  flush(): boolean {
    if (this.phase !== 'bottom') return false;
    this.phase = 'top';
    this.bottomAngle = 180;
    this.count += 1;
    return true;
  }

  /** Current rep thresholds (post-calibration). Used by the gauge. */
  getThresholds(): { downBelow: number; upAbove: number } {
    return { downBelow: this.calibratedDownBelow, upAbove: this.calibratedUpAbove };
  }

  /** True once right after a rep attempt got partway down but never reached
   * depth, then returned toward the top — "didn't go low enough". */
  consumeShallowMiss(): boolean {
    return this.shallow.consume();
  }

  /** True mid-rep (crossed the down threshold, hasn't returned to top yet) —
   * if an attempt closes while this is true, that rep never completed. */
  isPending(): boolean {
    return this.phase === 'bottom';
  }

  /** Get current calibration status (for debugging) */
  getCalibrationStatus() {
    return {
      observedMin: Math.round(this.observedMin),
      observedMax: Math.round(this.observedMax),
      calibratedDownBelow: Math.round(this.calibratedDownBelow),
      calibratedUpAbove: Math.round(this.calibratedUpAbove),
      calibrationReps: this.calibrationReps
    };
  }
}

/**
 * Legacy rep counter for non-pushup exercises.
 */
export class RepCounter {
  private phase: Phase = 'top';
  private bottomAngle = 180;
  private bottomEnteredAt = 0;
  private shallow = new ShallowMissTracker();
  count = 0;

  constructor(private readonly cfg: RepConfig) {}

  /** Feed a frame's primary angle. Returns a RepEvent when a rep completes. */
  update(angle: number | null, t: number): RepEvent | null {
    if (angle == null) return null;

    if (this.phase === 'top') {
      if (angle < this.cfg.downBelow) {
        this.phase = 'bottom';
        this.bottomAngle = angle;
        this.bottomEnteredAt = t;
      } else {
        this.shallow.track(angle, t, this.cfg.downBelow, this.cfg.upAbove);
      }
      return null;
    }

    // phase === 'bottom'
    this.bottomAngle = Math.min(this.bottomAngle, angle);
    if (angle > this.cfg.upAbove) {
      this.phase = 'top';
      // Bounced back up too fast to have been a real rep — filter the noise
      // spike instead of crediting it (see MIN_BOTTOM_DWELL_MS above).
      if (t - this.bottomEnteredAt < MIN_BOTTOM_DWELL_MS) {
        this.bottomAngle = 180;
        return null;
      }
      this.count += 1;
      const event: RepEvent = { index: this.count, t, bottomAngle: this.bottomAngle };
      this.bottomAngle = 180;
      return event;
    }
    return null;
  }

  reset() {
    this.phase = 'top';
    this.bottomAngle = 180;
    this.bottomEnteredAt = 0;
    this.shallow.reset();
    this.count = 0;
  }

  flush(): boolean {
    if (this.phase !== 'bottom') return false;
    this.phase = 'top';
    this.bottomAngle = 180;
    this.count += 1;
    return true;
  }

  /** Current rep thresholds. Used by the gauge. */
  getThresholds(): { downBelow: number; upAbove: number } {
    return { downBelow: this.cfg.downBelow, upAbove: this.cfg.upAbove };
  }

  /** True mid-rep (crossed the down threshold, hasn't returned to top yet) —
   * if an attempt closes while this is true, that rep never completed. */
  isPending(): boolean {
    return this.phase === 'bottom';
  }

  /** True once right after a rep attempt got partway down but never reached
   * depth, then returned toward the top — "didn't go low enough". */
  consumeShallowMiss(): boolean {
    return this.shallow.consume();
  }
}
