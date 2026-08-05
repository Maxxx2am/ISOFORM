import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * A subtle, branded background glow that sits behind the content layer on
 * key screens. Not a full-blown gradient background — just a faint radial
 * aura near the top that adds depth without screaming "look at me." The
 * difference between a pure-black background and one with this behind it is
 * the difference between a dev-build and a shipped app.
 */
export function Atmosphere() {
  const w = 500;
  const h = 500;
  return (
    <View style={styles.root} pointerEvents="none">
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <RadialGradient id="atm" cx="50%" cy="0%" r="70%">
            <Stop offset="0%" stopColor="#82f300" stopOpacity={0.06} />
            <Stop offset="40%" stopColor="#82f300" stopOpacity={0.025} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={w / 2} cy={0} r={h * 0.7} fill="url(#atm)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: -120, left: -80, right: 0, height: 380, overflow: 'hidden' },
});
