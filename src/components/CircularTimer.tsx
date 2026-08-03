import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/useTheme';

type CircularTimerProps = {
  label: string;
  sublabel?: string;
  progress?: number;
  ringColor?: string;
  size?: number;
  strokeWidth?: number;
};

/** Compact timer card. The linear progress cue is quieter and easier to scan
 * over a live camera than a large circular ring. */
export const CircularTimer = memo(function CircularTimer({
  label,
  sublabel,
  progress = 1,
  ringColor,
  size = 220,
}: CircularTimerProps) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const color = ringColor ?? t.accent.color;
  const width = Math.max(180, size);

  return (
    <View style={[styles.card, { width, borderColor: t.ink.hairline }]}>
      <View style={styles.center}>
        <Text variant="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.time}>{label}</Text>
        {sublabel ? <Text variant="label" tone="secondary" style={styles.sub}>{sublabel}</Text> : null}
      </View>
      <View style={[styles.track, { backgroundColor: t.ink.hairline }]}>
        <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 86, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 22, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.58)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  time: { fontVariant: ['tabular-nums'], fontSize: 48, lineHeight: 54, letterSpacing: -1 },
  sub: { marginTop: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 12 },
  fill: { height: '100%', borderRadius: 2 },
});
