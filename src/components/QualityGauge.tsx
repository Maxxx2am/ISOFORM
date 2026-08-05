import { memo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, Feedback, Surface } from '@/theme/palette';

/** Degrees off target beyond which it's counted as "as bad as it gets" — the
 * marker is already pinned to the bottom of the bar by this point. Left
 * untouched by the green-zone widening below — this sets how far the marker
 * travels per degree of real deviation (its actual sensitivity/movement),
 * which stays exactly as responsive as before. */
const MAX_RELEVANT_DEVIATION = 55 / 180;

/**
 * closeness (0 = worst, 1 = dead-on-target) cutoffs between red/yellow/green.
 * Was an even 1/3–2/3 split — device feedback was that a genuinely solid
 * attempt kept reading as right on the edge of green instead of comfortably
 * inside it. Widened green a bit (2/3 → 0.55, roughly ±18° → ±25° around
 * target) WITHOUT changing MAX_RELEVANT_DEVIATION, so the marker swings the
 * exact same distance for the same real angle change — only where the color
 * boundary falls on that same travel shifts. Shared by every hold exercise
 * (handstand, plank, front lever, planche...), so one change here widens all
 * of them consistently.
 */
const WARN_CLOSENESS = 1 / 3;
const GOOD_CLOSENESS = 0.55;

// Fallback before the real height is measured (matches styles.gauge.height) —
// see RepGauge's identical comment: callers can override the track's height
// via `style` (the review-screen replay does, to fit a shorter video box), so
// the containment math below measures the actual rendered height instead of
// assuming this constant — otherwise the marker's clamp math stays sized for
// a tall 240px track while rendering inside a shorter box, letting it float
// above the visible bar exactly like the bug already fixed in RepGauge.
const DEFAULT_GAUGE_HEIGHT = 240;
const MARKER_HEIGHT = 30;
// The track is a full pill (borderRadius == half its width) — see RepGauge's
// identical constant/comment. Without this, the marker's center could reach
// the geometric top/bottom, putting its square corners past where the pill
// has already curved inward, so overflow:hidden here clips a visible corner
// off the marker right at the extremes.
const CAP_CLEARANCE = 10;

/**
 * Vertical "traffic light" gauge for HOLD exercises (handstand, plank,
 * front lever, planche...). Unlike RepGauge (which rewards hitting either
 * extreme), a hold has ONE ideal shape — so the marker's position is your
 * CLOSENESS to `target`, not your raw angle. That's what keeps the three
 * bands an even third each no matter where the target numerically sits: a
 * handstand's target (178°, near the very top of the 0-180 scale) used to
 * squash green into a sliver and leave the bar mostly red once bands were
 * measured in raw degrees near an edge. Measuring by deviation instead means
 * dead-on-target always reads as the top of green, regardless of the target.
 */
// Memoized — re-rendered every camera frame by ExerciseTracker; `target` is
// derived once per exercise, so this mostly bails out except for `marker`.
export const QualityGauge = memo(function QualityGauge({
  marker,
  target,
  visible,
  style,
}: {
  marker: number;
  target: number;
  visible: boolean;
  /** Override the default full-screen (right-edge, vertically centered) placement. */
  style?: StyleProp<ViewStyle>;
}) {
  const [trackHeight, setTrackHeight] = useState(DEFAULT_GAUGE_HEIGHT);

  const clampedMarker = Math.min(1, Math.max(0, marker));
  const clampedTarget = Math.min(1, Math.max(0, target));
  const deviation = Math.abs(clampedMarker - clampedTarget);
  const closeness = 1 - Math.min(1, deviation / MAX_RELEVANT_DEVIATION); // 1 = dead on target, 0 = way off
  const color = closeness >= GOOD_CLOSENESS ? Feedback.good : closeness >= WARN_CLOSENESS ? Feedback.warn : Feedback.bad;

  // Clamp the capsule's CENTER so its top/bottom edges never cross the
  // track's own edges — same fix as RepGauge, so both bars read consistently.
  const half = MARKER_HEIGHT / 2;
  const inset = half + CAP_CLEARANCE;
  const centerPx = Math.min(trackHeight - inset, Math.max(inset, closeness * trackHeight));
  // Anchor at the top of the track. Keeping the marker and its animated
  // coordinate in the same top-to-bottom space prevents the live overlay
  // from translating in the wrong direction or beyond the visible bar.
  const markerTopPx = trackHeight - centerPx - half;

  if (!visible) return null;

  return (
    <View
      style={[styles.gauge, style]}
      pointerEvents="none"
      onLayout={(e) => setTrackHeight(e.nativeEvent.layout.height)}
    >
      {/* Three bands sized off the SAME WARN_CLOSENESS/GOOD_CLOSENESS cutoffs
          the marker's own color uses — red (worst) at the bottom, green (on
          target) at the top, so the background band the marker sits in
          always matches its own color, never a fixed even-thirds split that
          could disagree with a tuned threshold. Explicit corner radii
          (matching the container's 14) on the outer two bands —
          overflow:hidden alone clips them, but this guarantees the color
          fill's corners always trace the bar's own rounded shape instead of
          reading as a sharp-edged rectangle inside it. */}
      <View style={[styles.band, { bottom: '0%', height: `${WARN_CLOSENESS * 100}%`, backgroundColor: alpha(Feedback.bad, 0.22), borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }]} />
      <View style={[styles.band, { bottom: `${WARN_CLOSENESS * 100}%`, height: `${(GOOD_CLOSENESS - WARN_CLOSENESS) * 100}%`, backgroundColor: alpha(Feedback.warn, 0.22) }]} />
      <View style={[styles.band, { bottom: `${GOOD_CLOSENESS * 100}%`, height: `${(1 - GOOD_CLOSENESS) * 100}%`, backgroundColor: alpha(Feedback.good, 0.22), borderTopLeftRadius: 12, borderTopRightRadius: 12 }]} />

      <View
        style={[
          styles.marker,
          { top: markerTopPx, borderColor: color, backgroundColor: `${color}33` },
        ]}
      >
        <View style={[styles.markerCenterLine, { backgroundColor: color }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  gauge: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -120,
    height: 240,
    width: 28,
    borderRadius: 14,
    backgroundColor: alpha(Surface.raised, 0.65),
    borderWidth: 1.5,
    borderColor: alpha('#FFFFFF', 0.15),
    overflow: 'hidden',
  },
  band: { position: 'absolute', left: 0, right: 0 },
  marker: {
    position: 'absolute',
    left: 3,
    right: 3,
    height: 30,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    elevation: 2,
  },
  markerCenterLine: { width: 10, height: 2, borderRadius: 1, opacity: 0.9 },
});
