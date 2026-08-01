import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/useTheme';

const WEEKS = 16;
const DAYS = 7;
const GAP = 3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function CalendarHeatmap({ dates }: { dates: number[] }) {
  const t = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const now = new Date(); now.setHours(23, 59, 59, 999);
  const start = new Date(now); start.setDate(start.getDate() - (WEEKS * DAYS) + 1);
  start.setHours(0, 0, 0, 0);

  const size = Math.floor((screenWidth - 64 - (WEEKS - 1) * GAP) / WEEKS);

  const counts = new Map<number, number>();
  for (const d of dates) {
    const k = new Date(d); k.setHours(12, 0, 0, 0);
    counts.set(k.getTime(), (counts.get(k.getTime()) ?? 0) + 1);
  }

  const cells: { x: number; y: number; value: number }[] = [];
  const monthLabels: { x: number; label: string }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const date = new Date(start); date.setDate(start.getDate() + w * DAYS + d);
      const v = counts.get(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime()) ?? 0;
      cells.push({ x: w * (size + GAP), y: d * (size + GAP), value: v });
      if (date.getMonth() !== lastMonth && date.getDate() <= DAYS) {
        lastMonth = date.getMonth();
        monthLabels.push({ x: w * (size + GAP), label: MONTHS[date.getMonth()] });
      }
    }
  }

  const max = Math.max(1, ...cells.map((c) => c.value));
  const getColor = (v: number) => {
    if (v === 0) return t.surface.sunken;
    if (v <= 1) return `${t.accent.color}2E`;
    if (v <= 2) return `${t.accent.color}5C`;
    if (v <= 3) return `${t.accent.color}88`;
    if (v < max) return `${t.accent.color}AA`;
    return t.accent.color;
  };

  const svgW = WEEKS * (size + GAP) - GAP;
  const svgH = DAYS * (size + GAP) - GAP + 14;

  return (
    <View style={styles.wrapper}>
      <Svg width={svgW} height={svgH}>
        {cells.map((c, i) => (
          <Rect key={i} x={c.x} y={c.y} width={size} height={size} rx={Math.max(2, size * 0.15)} fill={getColor(c.value)} />
        ))}
        {monthLabels.map((m, i) => (
          <SvgText key={i} x={m.x} y={svgH - 2} fill={t.ink.muted} fontSize={Math.max(9, size * 0.55)} fontWeight="600">{m.label}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingHorizontal: 0,
  },
});
