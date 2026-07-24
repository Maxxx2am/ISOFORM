import type { Exercise, FormContext, FormRule } from '@/exercises/types';

export type CueTally = {
  ruleId: string;
  cue: string;
  severity: FormRule['severity'];
  /** How many frames violated this rule across the set. */
  frames: number;
};

/**
 * Evaluates an exercise's form rules each frame. Debounces so a cue only
 * "fires" (becomes the active on-screen hint) after it has been violated for a
 * few consecutive frames, and tallies totals for the end-of-set report.
 */
export class FormAnalyzer {
  private streak: Record<string, number> = {};
  private tally: Record<string, CueTally> = {};
  private totalFrames = 0;
  private framesWithViolation = 0;

  /** Consecutive violating frames before a cue is surfaced. */
  constructor(
    private readonly exercise: Exercise,
    private readonly fireAfter = 4,
  ) {}

  /** Returns the currently active cue text (highest severity), or null. */
  update(ctx: FormContext): FormRule | null {
    this.totalFrames += 1;
    let active: FormRule | null = null;
    let anyViolated = false;

    for (const rule of this.exercise.formRules) {
      const violated = safeTest(rule, ctx);
      if (violated) {
        // Only a real fault (`warn`) counts against the quality ratio — an
        // `info` rule (e.g. "go a little lower") fires every rep just from
        // transiting the depth zone on the way down/up, which is normal
        // geometry, not bad form. Counting it here dragged a clean set's
        // live quality into "bad form" territory mid-set even on an
        // otherwise-good rep (reported: 88 final score but red banner live).
        if (rule.severity === 'warn') anyViolated = true;
        this.streak[rule.id] = (this.streak[rule.id] ?? 0) + 1;
        const t = (this.tally[rule.id] ??= {
          ruleId: rule.id,
          cue: rule.cue,
          severity: rule.severity,
          frames: 0,
        });
        t.frames += 1;
        if (this.streak[rule.id] >= this.fireAfter) {
          if (!active || (rule.severity === 'warn' && active.severity === 'info')) {
            active = rule;
          }
        }
      } else {
        this.streak[rule.id] = 0;
      }
    }

    if (anyViolated) this.framesWithViolation += 1;

    return active;
  }

  /**
   * Overall form quality 0–100 based on what fraction of frames had ANY
   * rule violation. 100 = perfect, 0 = every frame broke something.
   */
  getFormQuality(): number {
    if (this.totalFrames === 0) return 100;
    return Math.round((1 - this.framesWithViolation / this.totalFrames) * 100);
  }

  /** Cues seen across the set, worst offenders first. */
  report(): CueTally[] {
    return Object.values(this.tally).sort((a, b) => b.frames - a.frames);
  }

  get frames() {
    return this.totalFrames;
  }

  reset() {
    this.streak = {};
    this.tally = {};
    this.totalFrames = 0;
    this.framesWithViolation = 0;
  }
}

function safeTest(rule: FormRule, ctx: FormContext): boolean {
  try {
    return rule.test(ctx);
  } catch {
    return false;
  }
}
