/** Shared trim math for what part of a session actually gets replayed/stored. */
import type { SessionSummary, TimelineSample } from '@/engine/sessionEngine';

const PAD_MS = 3000;

/**
 * Bounds the raw per-frame timeline down to just the padded window(s) around
 * the tracked action — the union of every replay `segment` when there are
 * any (a multi-attempt session's whole stitched highlight reel, not just its
 * best clip), falling back to a single window around firstActionMs/
 * lastActionMs for old data saved before `segments` existed. Either way,
 * what gets persisted to the database is only ever what a replay could
 * possibly show, not the whole raw camera session.
 */
export function trimTimelineForStorage(summary: SessionSummary, timeline: TimelineSample[]): TimelineSample[] {
  if (timeline.length === 0) return [];
  const tlStart = timeline[0].t;
  const tlEnd = timeline[timeline.length - 1].t;

  const windows =
    summary.segments.length > 0
      ? summary.segments.map((seg) => ({ startMs: Math.max(0, seg.startMs), endMs: Math.min(tlEnd, seg.endMs) }))
      : [
          {
            startMs: Math.max(0, (summary.firstActionMs ?? tlStart) - PAD_MS),
            endMs: Math.min(tlEnd || (summary.lastActionMs ?? tlEnd) + PAD_MS, (summary.lastActionMs ?? tlEnd) + PAD_MS),
          },
        ];

  const trimmed = timeline.filter((s) => windows.some((w) => s.t >= w.startMs && s.t <= w.endMs));
  return trimmed.length > 0 ? trimmed : timeline;
}
