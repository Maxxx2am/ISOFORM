import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/useTheme';

type CircularTimerProps = {
  /** Big center label, e.g. "01:24". */
  label: string;
  /** Small label under it, e.g. "SQUAT" or "REST". */
  sublabel?: string;
  /** Ring fill 0..1. Omit for a static full ring. */
  progress?: number;
  /** Override ring color (e.g. form quality: green/yellow/red). */
  ringColor?: string;
  size?: number;
  strokeWidth?: number;
};

/** Distraction-free circular timer. Thin isometric ring, accent progress.
 * Memoized — re-rendered every camera frame by ExerciseTracker via its parent
 * re-render, but its own inputs (label/progress/ringColor) don't change on
 * every one of those frames. */
export const CircularTimer = memo(function CircularTimer({
  label,
  sublabel,
  progress = 1,
  ringColor,
  size = 200,
  strokeWidth = 8,
}: CircularTimerProps) {
  const t = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashoffset = circumference * (1 - clamped);
  const color = ringColor ?? t.accent.color;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={t.ink.hairline}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress / form ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          fill="none"
          // start at 12 o'clock
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text variant="display" style={styles.time}>
          {label}
        </Text>
        {sublabel ? (
          <Text variant="label" tone="secondary" style={styles.sub}>
            {sublabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  time: { fontVariant: ['tabular-nums'] },
  sub: { marginTop: 4 },
});
