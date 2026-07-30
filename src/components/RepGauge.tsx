import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Feedback } from '@/theme/palette';

// The bottom "reached depth" zone and top "reached lockout" zone each
// occupy 25% of the bar — the middle 50% is the transition zone. A rep
// counts when you descend into the bottom green, then rise into the top
// green. The zones are always this same fixed proportion regardless of the
// exercise's actual angle range (the marker warps to match).
const VISUAL_DOWN = 0.25;
const VISUAL_UP = 0.75;

// Fallback before the real height is measured (matches styles.gauge.height) —
// callers like the review-screen replay override the track's height via the
// `style` prop to fit a shorter video box, so the containment math below
// MEASURES the actual rendered height instead of assuming this constant;
// using the constant unconditionally was itself a bug (the marker's
// clamp math would still assume a tall 240px track while rendering inside a
// much shorter overridden box, letting it float above the visible bar).
const DEFAULT_GAUGE_HEIGHT = 240;
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
export function RepGauge({
  marker,
  down,
  up,
  visible,
  style,
}: {
  marker: number;
  down: number;
  up: number;
  visible: boolean;
  /** Override the default full-screen (right-edge, vertically centered) placement. */
  style?: StyleProp<ViewStyle>;
}) {
  const [trackHeight, setTrackHeight] = useState(DEFAULT_GAUGE_HEIGHT);

  if (!visible) return null;

  const inZone = marker <= down || marker >= up;

  // Warp the raw 0-1 angle into the fixed visual bands using THIS exercise's
  // own down/up as the pivots — generic to any exercise, no hardcoded shape.
  let visualMarker: number;
  if (marker <= down) {
    visualMarker = down > 0 ? (marker / down) * VISUAL_DOWN : 0;
  } else if (marker >= up) {
    visualMarker = up < 1 ? VISUAL_UP + ((marker - up) / (1 - up)) * (1 - VISUAL_UP) : 1;
  } else {
    visualMarker = VISUAL_DOWN + ((marker - down) / (up - down)) * (VISUAL_UP - VISUAL_DOWN);
  }
  visualMarker = Math.min(1, Math.max(0, visualMarker));

  // Clamp the capsule's CENTER so its top/bottom edges never cross the
  // track's own edges — this is what keeps it "in the bar" at 0% and 100%.
  const half = MARKER_HEIGHT / 2;
  const inset = half + CAP_CLEARANCE;
  const centerPx = Math.min(trackHeight - inset, Math.max(inset, visualMarker * trackHeight));
  const markerBottomPx = centerPx - half;

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
            borderTopColor: 'rgba(48,209,88,0.85)',
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
            borderBottomColor: 'rgba(48,209,88,0.85)',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          },
        ]}
      />

      {/* Live motion marker capsule */}
      <View
        style={[
          styles.marker,
          {
            bottom: markerBottomPx,
            borderColor: inZone ? Feedback.good : '#FFFFFF',
            backgroundColor: inZone ? 'rgba(48,209,88,0.25)' : 'rgba(255,255,255,0.15)',
          },
        ]}
      >
        <View style={[styles.markerCenterLine, { backgroundColor: inZone ? Feedback.good : '#FFFFFF' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gauge: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -120,
    height: 240,
    width: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,24,0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
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
    backgroundColor: 'rgba(48,209,88,0.18)',
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
