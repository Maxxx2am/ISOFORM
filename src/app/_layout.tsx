import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FatalErrorScreen } from '@/components/FatalErrorScreen';
import { installGlobalErrorHandler, onFatalError } from '@/lib/globalErrorHandler';
import { preloadAppImages } from '@/lib/preloadAssets';
import { useTheme } from '@/theme/useTheme';

installGlobalErrorHandler();

// Take manual control of the splash screen the moment this module loads —
// before any component has mounted — instead of relying on expo-splash-
// screen's automatic "hide on first frame" behavior. If that automatic
// signal ever fails to fire, the splash sits on top of EVERYTHING forever,
// including the error screen below, and looks exactly like a stuck black
// screen with zero information about why.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fatal, setFatal] = useState<Error | null>(null);

  useEffect(() => onFatalError((error) => setFatal(error)), []);

  // Hide the splash as soon as this component has mounted — on the success
  // path AND the error path, since ErrorBoundary's fallback is what commits
  // here if a child throws. Either way, something must become visible.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Preload rank/achievement/streak icons once the first screen has fully
  // rendered — InteractionManager.runAfterInteractions queues work after
  // the native transition + any pending animations finish, so this never
  // competes with the initial frame. In a production build with bundled
  // assets this is a no-op, but in Expo Go it saves 20+ Metro round-trips
  // from hitting the bridge during the critical first render path.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      preloadAppImages();
    });
    return () => handle.cancel();
  }, []);

  if (fatal) return <FatalErrorScreen error={fatal} />;

  return (
    <ErrorBoundary>
      <ThemedRoot />
    </ErrorBoundary>
  );
}

/** Split out so useTheme() (which reads persisted settings) runs INSIDE the
 * boundary — if it throws, the boundary still catches it instead of a blank screen. */
function ThemedRoot() {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.surface.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.surface.base },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="workout/active"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="workout/run"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen name="workout/review/[id]" />
          <Stack.Screen name="exercise/[slug]" options={{ presentation: 'card' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
