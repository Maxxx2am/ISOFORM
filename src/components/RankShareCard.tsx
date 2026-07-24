import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Alert, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { RANK_ICON_ASPECT, RANK_ICONS, rankColor, type RankTier } from '@/lib/rank';
import { Surface } from '@/theme/palette';

const CARD_W = 800;
const CARD_H = 1000;
const ICON_H = 380;
const CX = CARD_W / 2;
const CY = 470; // medal's vertical center — rays/spotlight/sparkles all key off this

/** Ray angles for the sunburst behind the medal — fixed, not random, since
 * this stays mounted off-screen the whole time the Insights tab is open and
 * re-rolling positions every render would make it visibly shimmer/jitter. */
const RAY_ANGLES = Array.from({ length: 24 }, (_, i) => (360 / 24) * i);

/** A handful of fixed sparkle positions scattered around the medal, each a
 * tiny 4-point star — the "hey, look at this" celebratory dressing that
 * turns a plain badge shot into something worth actually sharing. */
const SPARKLES: { x: number; y: number; size: number; opacity: number }[] = [
  { x: 130, y: 220, size: 14, opacity: 0.9 },
  { x: 690, y: 260, size: 10, opacity: 0.7 },
  { x: 95, y: 430, size: 9, opacity: 0.6 },
  { x: 720, y: 470, size: 16, opacity: 0.85 },
  { x: 160, y: 610, size: 8, opacity: 0.55 },
  { x: 650, y: 630, size: 11, opacity: 0.7 },
];

/** A 4-point "sparkle" star path centered at (x, y) — 8 points alternating
 * between the outer radius and a pinched inner radius. */
function sparklePath(x: number, y: number, r: number): string {
  const rInner = r * 0.35;
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : rInner;
    pts.push([x + radius * Math.cos(angle), y + radius * Math.sin(angle)]);
  }
  return `M ${pts[0][0]} ${pts[0][1]} ${pts.slice(1).map(([px, py]) => `L ${px} ${py}`).join(' ')} Z`;
}

export type RankShareCardHandle = {
  share: () => void;
};

/**
 * Renders a shareable "rank card" (icon + tier + exercise + value) off-screen
 * via react-native-svg, then captures it with Svg's native `toDataURL()` and
 * hands the PNG to the system share sheet. No screenshot library needed —
 * `toDataURL` ships inside react-native-svg (already a dependency here), so
 * this stays Expo-Go-compatible with zero new native modules.
 */
export const RankShareCard = forwardRef<
  RankShareCardHandle,
  { tier: RankTier; exerciseName: string; mode: 'reps' | 'hold'; value: number }
>(function RankShareCard({ tier, exerciseName, mode, value }, ref) {
  const svgRef = useRef<Svg>(null);
  const color = rankColor(tier);
  const aspect = RANK_ICON_ASPECT[tier];
  const iconW = ICON_H * aspect;
  const valueLabel = mode === 'reps' ? `${value} reps` : `${value}s hold`;

  useImperativeHandle(ref, () => ({
    share: () => {
      svgRef.current?.toDataURL(async (base64: string) => {
        try {
          const uri = `${FileSystem.cacheDirectory}rank-${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${tier} — ${exerciseName}` });
          } else {
            Alert.alert('Sharing unavailable', 'Your device can’t share images right now.');
          }
        } catch {
          Alert.alert('Couldn’t create the image', 'Try again in a moment.');
        }
      });
    },
  }));

  return (
    // Laid out off-canvas (not visually shown) — toDataURL needs the native
    // view actually mounted/rendered to capture it.
    <View pointerEvents="none" style={{ position: 'absolute', left: -99999, top: 0 }}>
      <Svg ref={svgRef} width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="34%" r="42%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="60%" stopColor={color} stopOpacity={0.18} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
          {/* Diagonal, multi-stop instead of flat top-to-bottom — the extra
              color/white/color pass reads as a shimmering holo-foil edge
              instead of a plain colored border. */}
          <LinearGradient id="edge" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <Stop offset="35%" stopColor="#FFFFFF" stopOpacity={0.5} />
            <Stop offset="55%" stopColor={color} stopOpacity={0.9} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.3} />
          </LinearGradient>
          {/* Darkens the corners so the lit medal in the center pops harder —
              classic "spotlight" vignette instead of a flat-lit card. */}
          <RadialGradient id="vignette" cx="50%" cy="46%" r="72%">
            <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
            <Stop offset="70%" stopColor="#000000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0.5} />
          </RadialGradient>
          <RadialGradient id="rayFade" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
          {/* Matches the outer card Rect exactly — every ray/glow/sparkle
              below is clipped to this so nothing can bleed past the rounded
              corners. Without it, translucent strokes (rays especially)
              extend into the corner cutouts; invisible on a dark backdrop
              but a visible smudge once shared onto a light one. */}
          <ClipPath id="cardClip">
            <Rect x={0} y={0} width={CARD_W} height={CARD_H} rx={48} />
          </ClipPath>
        </Defs>

        <G clipPath="url(#cardClip)">
        {/* Base + glowing radial backdrop behind the medal */}
        <Rect x={0} y={0} width={CARD_W} height={CARD_H} rx={48} fill={Surface.base} />
        <Rect x={10} y={10} width={CARD_W - 20} height={CARD_H - 20} rx={40} fill="url(#edge)" />
        <Rect x={16} y={16} width={CARD_W - 32} height={CARD_H - 32} rx={36} fill={Surface.raised} />
        <Rect x={16} y={16} width={CARD_W - 32} height={CARD_H - 32} rx={36} fill="url(#glow)" />

        {/* Sunburst rays radiating from behind the medal — the "level up"
            reveal effect that makes this read as a celebration, not a stat card. */}
        <G opacity={0.5}>
          {RAY_ANGLES.map((deg, i) => (
            <Line
              key={deg}
              x1={CX}
              y1={CY}
              x2={CX + Math.cos((deg * Math.PI) / 180) * 480}
              y2={CY + Math.sin((deg * Math.PI) / 180) * 480}
              stroke={color}
              strokeWidth={i % 2 === 0 ? 5 : 2}
              strokeOpacity={i % 2 === 0 ? 0.22 : 0.12}
            />
          ))}
        </G>
        <Circle cx={CX} cy={CY} r={340} fill="url(#rayFade)" />

        {/* Corner accent ticks, tier-colored */}
        <Line x1={56} y1={90} x2={110} y2={90} stroke={color} strokeWidth={4} strokeOpacity={0.6} />
        <Line x1={CARD_W - 56} y1={90} x2={CARD_W - 110} y2={90} stroke={color} strokeWidth={4} strokeOpacity={0.6} />

        <SvgText x={CX} y={90} fontSize={26} fontWeight="700" fill="#9A9AA1" textAnchor="middle" letterSpacing={4}>
          MY RANK
        </SvgText>

        {/* Soft ellipse "spotlight" the medal sits on */}
        <Circle cx={CX} cy={470} r={230} fill={color} opacity={0.12} />

        <SvgImage
          href={RANK_ICONS[tier]}
          x={(CARD_W - iconW) / 2}
          y={140}
          width={iconW}
          height={ICON_H}
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Sparkle dressing scattered around the medal, on top so they pop. */}
        {SPARKLES.map((s) => (
          <Path key={`${s.x}-${s.y}`} d={sparklePath(s.x, s.y, s.size)} fill="#FFFFFF" opacity={s.opacity} />
        ))}

        {/* Vignette sits over the backdrop/rays but under the headline text. */}
        <Rect x={16} y={16} width={CARD_W - 32} height={CARD_H - 32} rx={36} fill="url(#vignette)" />

        {/* Triple-stacked offset text gives the headline real depth instead
            of a single flat drop-shadow. */}
        <SvgText x={CX} y={628} fontSize={68} fontWeight="800" fill="#000000" opacity={0.25} textAnchor="middle">
          {tier}
        </SvgText>
        <SvgText x={CX} y={624} fontSize={68} fontWeight="800" fill="#000000" opacity={0.35} textAnchor="middle">
          {tier}
        </SvgText>
        <SvgText x={CX} y={620} fontSize={68} fontWeight="800" fill={color} textAnchor="middle">
          {tier}
        </SvgText>

        <Line x1={CX - 90} y1={655} x2={CX + 90} y2={655} stroke={color} strokeWidth={2} strokeOpacity={0.5} />

        <SvgText x={CX} y={702} fontSize={30} fontWeight="600" fill="#9A9AA1" textAnchor="middle">
          {exerciseName}
        </SvgText>
        {/* The number is the whole point of the flex — biggest text after the tier itself. */}
        <SvgText x={CX} y={766} fontSize={58} fontWeight="800" fill="#FFFFFF" textAnchor="middle">
          {valueLabel}
        </SvgText>

        <Line x1={70} y1={CARD_H - 100} x2={CARD_W - 70} y2={CARD_H - 100} stroke={Surface.sunken} strokeWidth={2} />
        <SvgText x={CX} y={CARD_H - 56} fontSize={28} fontWeight="800" fill="#5E5E66" textAnchor="middle" letterSpacing={3}>
          ISOFORM
        </SvgText>
        </G>
      </Svg>
    </View>
  );
});
