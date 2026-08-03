import { memo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, Feedback, Surface } from '@/theme/palette';

// The bottom "reached depth" zone and top "reached lockout" zone are always
// drawn at this same fixed size — a glute bridge's down/up thresholds are
// nowhere near a push-up's numerically, but the two green bands must still
// look identical, the same way they do on a push-up.
const VISUAL_DOWN = 0.2;
const VISUAL_UP = 0.8;

// Fallback before the real height is measured (matches styles.gauge.height).
const MARKER_HEIGHT = 30;
// The track is a full pill (borderRadius == half its width), so its very
// top/bottom aren't flat — they're semicircular caps. Letting the marker's
// center reach all the way to the geometric edge put its square corners
// past where the pill has already curved inward: poking outside the bar's
// silhouette here (RepGauge has no clip), or getting clipped by the curve on
// QualityGauge (which does). This extra clearance keeps it inside the
// actual flat-sided part of the pill on both.
const CAP_CLEARANCE = 10;

/**
 * Vertical rep gauge. Both green zones are always drawn the same fixed size
 * (bottom 20% / top 20%, gray 60% between) regardless of the exercise's real
 * angle thresholds — the marker is warped to match, using THIS exercise's own
 * down/up values as the pivot points (not a hardcoded push-up-shaped curve),
 * so it's calibrated correctly for any move. The two zones are where a rep
 * counts: descend into the LOWER one, extend into the UPPER one.
 */
// Memoized — re-rendered every camera frame by ExerciseTracker, but down/up
// are derived once per exercise (not per-frame) so this mostly bails out on
// unchanged props except for the marker itself.
export const RepGauge = memo(function RepGauge({
  marker,
  down,
  up,
  visible,
  smooth = true,
  style,
}: {
  marker: number;
  down: number;
  up: number;
  visible: boolean;
  /** Live tracking benefits from smoothing; replay should show exact frame zones. */
  smooth?: boolean;
  /** Override the default full-screen (right-edge, vertically centered) placement. */
  style?: StyleProp<ViewStyle>;
}) {
  const [trackHeight, setTrackHeight] = useState(0);
  const markerRef = useRef(marker);
  // Keep the visual marker stable when MediaPipe briefly drops a landmark.
  // Counting still uses the raw angle; this only removes UI flicker.
  markerRef.current += (marker - markerRef.current) * 0.35;
  const displayMarker = smooth ? markerRef.current : marker;

  // Don't render the marker capsule until layout gives us the real track
  // height — on the very first frame trackHeight is 0 (was DEFAULT_GAUGE_HEIGHT
  // = 240), so the marker position math would produce a value for a bar that's
  // a different size than what's actually on screen (e.g. the review screen's
  // shorter overridden bar). One-frame visual glitch, but noticeable.
  const ready = trackHeight > 0;

  const inZone = displayMarker <= down || displayMarker >= up;

  // Warp the raw 0-1 angle into the fixed visual bands using THIS exercise's
  // own down/up as the pivots — generic to any exercise, no hardcoded shape.
  let visualMarker: number;
  if (displayMarker <= down) {
    visualMarker = down > 0 ? (displayMarker / down) * VISUAL_DOWN : 0;
  } else if (displayMarker >= up) {
    visualMarker = up < 1 ? VISUAL_UP + ((displayMarker - up) / (1 - up)) * (1 - VISUAL_UP) : 1;
  } else {
    visualMarker = VISUAL_DOWN + ((displayMarker - down) / (up - down)) * (VISUAL_UP - VISUAL_DOWN);
  }
  visualMarker = Math.min(1, Math.max(0, visualMarker));

  // Clamp the capsule's CENTER so its top/bottom edges never cross the
  // track's own edges — this is what keeps it "in the bar" at 0% and 100%.
  const half = MARKER_HEIGHT / 2;
  const inset = half + CAP_CLEARANCE;
  const centerPx = ready
    ? Math.min(trackHeight - inset, Math.max(inset, visualMarker * trackHeight))
    : 0;
  // Anchor at the top of the track, so the native transform uses the same
  // top-to-bottom coordinate system as the rendered bar. The previous
  // bottom-anchored transform inverted this distance and could move the live
  // marker outside the track while the replay happened to look responsive.
  const markerTopPx = trackHeight - centerPx - half;

  if (!visible) return null;

  return (
    <View
      style={[styles.gauge, style]}
      pointerEvents="none"
      onLayout={(e) => setTrackHeight(e.nativeEvent.layout.height)}
    >
      {/* Tick marks behind zones */}
      <View style={styles.ticksContainer}>
        <View style={styles.tick} />
        <View style={styles.tick} />
        <View style={styles.tick} />
        <View style={styles.tick} />
        <View style={styles.tick} />
      </View>

      {/* depth zone — fixed-size bottom band */}
      <View
        style={[
          styles.zone,
          {
            bottom: 0,
            height: `${VISUAL_DOWN * 100}%`,
            borderTopWidth: 2,
            borderTopColor: alpha(Feedback.good, 0.85),
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
          },
        ]}
      />

      {/* lockout zone — fixed-size top band, same size as the depth zone */}
      <View
        style={[
          styles.zone,
          {
            bottom: `${VISUAL_UP * 100}%`,
            height: `${(1 - VISUAL_UP) * 100}%`,
            borderBottomWidth: 2,
            borderBottomColor: alpha(Feedback.good, 0.85),
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          },
        ]}
      />

      {/* Live motion marker capsule — hidden until layout measures the track */}
      {ready ? (
        <View
          style={[
            styles.marker,
            {
              top: markerTopPx,
              borderColor: inZone ? Feedback.good : '#FFFFFF',
              backgroundColor: inZone ? alpha(Feedback.good, 0.25) : alpha('#FFFFFF', 0.15),
            },
          ]}
        >
          <View style={[styles.markerCenterLine, { backgroundColor: inZone ? Feedback.good : '#FFFFFF' }]} />
        </View>
      ) : null}
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
  },
  ticksContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'space-between',
    paddingVertical: 20,
    opacity: 0.15,
  },
  tick: {
    height: 1,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 6,
  },
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: alpha(Feedback.good, 0.18),
  },
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
  markerCenterLine: {
    width: 10,
    height: 2,
    borderRadius: 1,
    opacity: 0.8,
  },
});
