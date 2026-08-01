/**
 * One-Euro filter (Casiez, Roussel & Vogel, 2012) — an adaptive low-pass
 * filter tuned for exactly this problem: MediaPipe's raw per-frame landmarks
 * are noisy enough to visibly shake even when the athlete is holding still,
 * but a fixed-strength low-pass either leaves that jitter in (weak) or lags
 * behind real rep motion (strong). The one-euro filter raises its cutoff
 * frequency with the point's speed, so it filters hard at rest and barely at
 * all during a fast rep — smooth AND responsive instead of a compromise.
 *
 * Applied to landmark x/y only (see LandmarkSmoother below) — z isn't used
 * by any exercise's angle math and visibility must stay raw for gating.
 */

class LowPassFilter {
  private y: number | null = null;

  filter(x: number, alpha: number): number {
    this.y = this.y == null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  reset() {
    this.y = null;
  }
}

export class OneEuroFilter {
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastT: number | null = null;
  private lastX: number | null = null;

  /**
   * @param minCutoff Hz — cutoff used while the point is still; lower = smoother at rest.
   * @param beta Speed coefficient — how much cutoff rises with speed; higher = less lag on fast motion.
   * @param dCutoff Hz — cutoff for the speed estimate itself (rarely needs tuning).
   */
  constructor(
    private minCutoff = 1.2,
    private beta = 0.4,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param t seconds (must be monotonically increasing). */
  filter(x: number, t: number): number {
    if (this.lastT == null) {
      this.lastT = t;
      this.lastX = x;
      return this.xFilter.filter(x, 1);
    }
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const dx = (x - (this.lastX ?? x)) / dt;
    this.lastX = x;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(x, this.alpha(cutoff, dt));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastT = null;
    this.lastX = null;
  }
}

/**
 * Independent one-euro filters for selected landmarks' x and y.
 *
 * Only creates filters for the indices listed in `indices[]` — face, hand-detail
 * and foot-detail landmarks pass through unsmoothed. That cuts ~65% of the
 * per-frame filter budget (12 key joints instead of 33).
 *
 * Mutates the input array in place (no object-spread copies, no output
 * allocation) — safe because the caller already produces a fresh Landmark[]
 * per frame in useCameraPose.ts.
 */
export class LandmarkSmoother {
  private filters: Map<number, { x: OneEuroFilter; y: OneEuroFilter }> = new Map();

  constructor(
    indices: readonly number[],
    private minCutoff = 1.2,
    private beta = 0.4,
  ) {
    for (const i of indices) {
      this.filters.set(i, {
        x: new OneEuroFilter(minCutoff, beta),
        y: new OneEuroFilter(minCutoff, beta),
      });
    }
  }

  /**
   * Smooths selected landmarks in-place. Non-selected landmarks pass through
   * untouched. Returns the same array reference. `tSeconds` must be monotonic.
   */
  smooth<T extends { x: number; y: number }>(landmarks: T[], tSeconds: number): T[] {
    for (const [i, f] of this.filters) {
      const lm = landmarks[i];
      if (!lm) continue;
      lm.x = f.x.filter(lm.x, tSeconds);
      lm.y = f.y.filter(lm.y, tSeconds);
    }
    return landmarks;
  }

  /** Call when tracking restarts (camera flip, new session) so stale filter state
   *  from the previous pose doesn't drag the first new frames toward it. */
  reset() {
    for (const f of this.filters.values()) {
      f.x.reset();
      f.y.reset();
    }
  }
}
