import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

/**
 * Plain, standard bottom tab bar — deliberately simple. The floating pill
 * design (position:'absolute', custom tabBarActiveBackgroundColor/item
 * styling) is parked for now: it's the one significant piece of custom
 * native-adjacent styling added on top of react-native-screens this session,
 * present in every build that's failed to boot so far, and worth ruling out
 * before spending another scarce build on anything else. Bring the fancier
 * version back once a build this plain is confirmed to actually open.
 */
export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent.color,
        tabBarInactiveTintColor: t.ink.muted,
        tabBarStyle: {
          backgroundColor: t.surface.base,
          borderTopColor: t.ink.hairline,
          borderTopWidth: 1,
        },
        sceneStyle: { backgroundColor: t.surface.base },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Train',
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
