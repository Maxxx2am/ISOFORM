/** Shared trim math for what part of a session actually gets replayed/stored. */
import type { SessionSummary, TimelineSample } from '@/engine/sessionEngine';

const PAD_MS = 3000;

/**
 * Bounds the raw per-frame timeline down to just the padded window around the
 * tracked action (same padding the review screen uses to trim playback) —
 * so what gets persisted to the database is only ever what a replay could
 * possibly show, not the whole raw camera session.
 */
export function trimTimelineForStorage(summary: SessionSummary, timeline: TimelineSample[]): TimelineSample[] {
  if (timeline.length === 0) return [];
  const tlStart = timeline[0].t;
  const tlEnd = timeline[timeline.length - 1].t;
  const first = summary.firstActionMs ?? tlStart;
  const last = summary.lastActionMs ?? tlEnd;
  const startMs = Math.max(0, first - PAD_MS);
  const endMs = Math.min(tlEnd || last + PAD_MS, last + PAD_MS);
  const trimmed = timeline.filter((s) => s.t >= startMs && s.t <= endMs);
  return trimmed.length > 0 ? trimmed : timeline;
}
