import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Feedback } from '@/theme/palette';

const COLORS = [Feedback.good, Feedback.warn, '#0A84FF', '#BF5AF2', '#FF375F', '#FFD60A'];
const COUNT = 26;
const DURATION_MS = 1700;

type Piece = {
  x: number;
  fallFraction: number;
  drift: number;
  rotate: number;
  color: string;
  size: number;
};

/**
 * A one-shot confetti burst for "you beat your personal record" — built on
 * React Native's core `Animated` API only (no reanimated/lottie dependency;
 * `react-native-reanimated` isn't actually installed in this project despite
 * older notes suggesting otherwise). Mount to fire, call `onDone` to unmount.
 */
export function Confetti({ onDone }: { onDone?: () => void }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        x: Math.random() * width,
        fallFraction: 0.7 + Math.random() * 0.3,
        drift: (Math.random() - 0.5) * 140,
        rotate: 180 + Math.random() * 540,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
      })),
    [width],
  );

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-20, height * p.fallFraction],
        });
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rotate}deg`] });
        const opacity = progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: 0,
              width: p.size,
              height: p.size * 1.6,
              backgroundColor: p.color,
              borderRadius: 1.5,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
