import type { RepConfig } from '@/exercises/types';

type Phase = 'top' | 'bottom';

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
  private observedMin = 180;
  private observedMax = 0;
  private calibrationReps = 0;
  private calibratedDownBelow = 115;
  private calibratedUpAbove = 160;
  count = 0;

  constructor(private readonly cfg: RepConfig) {}

  /** Feed a frame's primary angle. Returns a RepEvent when a rep completes. */
  update(angle: number | null, t: number): RepEvent | null {
    if (angle == null) return null;

    // Phase 1-2: Learn the actual range of motion
    if (this.calibrationReps < 3) {
      this.observedMin = Math.min(this.observedMin, angle);
      this.observedMax = Math.max(this.observedMax, angle);

      if (this.phase === 'bottom' && angle > (this.calibratedUpAbove || this.cfg.upAbove)) {
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

      if (this.phase === 'top' && angle < this.calibratedDownBelow) {
        this.phase = 'bottom';
        this.bottomAngle = angle;
      }
      return null;
    }

    // Phase 3+: Use adaptive thresholds
    const threshold = () => ({
      downBelow: this.calibratedDownBelow,
      upAbove: this.calibratedUpAbove
    });

    if (this.phase === 'top') {
      if (angle < threshold().downBelow) {
        this.phase = 'bottom';
        this.bottomAngle = angle;
      }
      return null;
    }

    // phase === 'bottom'
    this.bottomAngle = Math.min(this.bottomAngle, angle);
    if (angle > threshold().upAbove) {
      this.phase = 'top';
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
    this.observedMin = 180;
    this.observedMax = 0;
    this.calibrationReps = 0;
    this.calibratedDownBelow = 115;
    this.calibratedUpAbove = 160;
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
  count = 0;

  constructor(private readonly cfg: RepConfig) {}

  /** Feed a frame's primary angle. Returns a RepEvent when a rep completes. */
  update(angle: number | null, t: number): RepEvent | null {
    if (angle == null) return null;

    if (this.phase === 'top') {
      if (angle < this.cfg.downBelow) {
        this.phase = 'bottom';
        this.bottomAngle = angle;
      }
      return null;
    }

    // phase === 'bottom'
    this.bottomAngle = Math.min(this.bottomAngle, angle);
    if (angle > this.cfg.upAbove) {
      this.phase = 'top';
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
}
