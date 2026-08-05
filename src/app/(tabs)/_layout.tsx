import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { router, Tabs, usePathname } from 'expo-router';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Shared press-scale bounce with haptic tap. Uses spring for a crisp, snappy
 *  return that reads as a real physical button instead of a sluggish fade.
 *  `native` must be false when this value is later combined (e.g.
 *  Animated.multiply) with a JS-driven value like a color interpolation —
 *  mixing a native-driven and JS-driven node in one derived Animated node
 *  crashes ("moved to native earlier by starting an animation with
 *  useNativeDriver: true"). TabButton needs JS (it multiplies scale by the
 *  focus-color interpolation); the plain SearchButton can stay native. */
function usePressScale(native: boolean = true) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scale, { toValue: 0.9, useNativeDriver: native, speed: 40, bounciness: 4 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: native, friction: 4, tension: 100 }).start();
  };
  return { scale, onPressIn, onPressOut };
}

const TAB_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  index: { label: 'Train', icon: 'barbell' },
  insights: { label: 'Profile', icon: 'person-circle' },
};

/** A real shadow (not just a border) so the bar reads as floating ABOVE the
 * page instead of sitting flush with it — most needed on Profile, which is
 * full of `surface.raised` cards in a similar tone to the old bar color. */
const tabBarShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.45,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 10,
};

/** Real frosted-glass blur behind the bar, tinted dark for this theme. Blur
 * alone reads as too see-through at this size/radius, so `BlurTint` layers a
 * low-opacity dark wash on top — frosted AND fairly solid, not just glassy. */
function BlurTint() {
  return (
    <>
      <BlurView intensity={78} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(18,18,20,0.5)' }]} />
    </>
  );
}

/**
 * Fully custom tab bar (not tabBarIcon/tabBarButton) — React Navigation's
 * default tab-item slot is sized for an icon-only glyph and clips anything
 * wider it's handed (this is what caused the earlier bug: the icon+label
 * pill got clipped down to a blank blob / a truncated "Pr"). Rendering the
 * whole bar by hand from `state.routes` sidesteps that entirely and is also
 * what makes it possible to put a separate, non-tab search circle next to
 * the two-tab pill, matching the reference sketch: [Train | Profile] (one
 * pill) + a standalone circle that opens /search, not a 3rd tab.
 *
 * Uses `expo-blur` (a standard, Expo-Go-compatible SDK module — unlike the
 * custom native modules elsewhere in this app that need a dev client build)
 * for the frosted background. A prior floating-tab-bar attempt was suspected
 * (never confirmed) of causing native build failures before the first
 * successful TestFlight build; this is a different, well-supported module,
 * but still needs a real EAS build to fully confirm it's safe.
 */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.surface.base },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Train' }} />
      <Tabs.Screen name="insights" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isTabRoute = pathname === '/' || pathname === '/insights';
  if (!isTabRoute) return null;

  const bottom = Math.max(Spacing.lg, insets.bottom + Spacing.xs);

  return (
    <View style={{ position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom, ...tabBarShadow }}>
      <View style={styles.dockSurface}>
        <BlurTint />
        {state.routes.map((route) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const focused = pathname === `/${route.name}` || (route.name === 'index' && pathname === '/');
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return <TabButton key={route.key} meta={meta} focused={focused} onPress={onPress} />;
        })}
        <SearchButton />
      </View>
    </View>
  );
}

function TabButton({
  meta,
  focused,
  onPress,
}: {
  meta: { label: string; icon: keyof typeof Ionicons.glyphMap };
  focused: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(false);
  const color = focused ? t.accent.onColor : t.ink.muted;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      style={{ flex: 1, padding: 4 }}
    >
      {/* Fills its half of the bar (not just a content-hugging chip floating
          in a lot of dead space) so the two tabs read as one evenly-split
          control, matched in scale to the search circle beside it. */}
      <Animated.View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          borderRadius: Radius.pill,
          backgroundColor: focused ? t.accent.color : 'transparent',
          transform: [{ scale }],
        }}
      >
        <Ionicons name={meta.icon} size={20} color={color} />
        <Text variant="body" numberOfLines={1} style={{ color, fontWeight: '700' }}>
          {meta.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function SearchButton() {
  const t = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      onPress={() => router.push('/search')}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel="Search"
    >
      <Animated.View style={{ width: 58, height: 58, borderRadius: Radius.md, transform: [{ scale }] }}>
        <View
          style={{
            flex: 1,
            borderRadius: Radius.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: t.ink.hairline,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BlurTint />
          <Ionicons name="search" size={22} color={t.ink.primary} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dockSurface: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 4,
  },
});
