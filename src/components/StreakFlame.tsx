import { Image, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * The streak flame: a single asset, intensity conveyed by opacity/size/glow
 * instead of needing separate art per streak length. The "blazing" glow is a
 * true SVG radial gradient behind the flame — a native `shadow*` prop on the
 * Image would render a rectangular drop-shadow following the layer's square
 * bounding box (no shadowPath support in RN), which read as a hard-edged
 * "border" box around the flame instead of a soft aura, and couldn't be made
 * bigger without just blurring that same box further.
 */
export function StreakFlame({ days }: { days: number }) {
  const lit = days > 0;
  const blazing = days >= 7;
  const size = blazing ? 17 : lit ? 15 : 13;
  // Fixed box instead of scaling with streak length — a bigger glow made the
  // icon read as the card's main event instead of the number, which is the
  // whole point of the stat.
  const box = 40;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {blazing ? (
        <Svg width={box} height={box} style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id="flameGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FF6A2E" stopOpacity={0.55} />
              <Stop offset="55%" stopColor="#FF6A2E" stopOpacity={0.2} />
              <Stop offset="100%" stopColor="#FF6A2E" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={box / 2} cy={box / 2} r={box / 2} fill="url(#flameGlow)" />
        </Svg>
      ) : null}
      <Image
        source={require('../../assets/images/streak/flame.png')}
        style={{ width: size, height: size * 1.5, opacity: lit ? 1 : 0.3 }}
        resizeMode="contain"
      />
    </View>
  );
}
