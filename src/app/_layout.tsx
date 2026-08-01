import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FatalErrorScreen } from '@/components/FatalErrorScreen';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { startAutoRefresh } from '@/exercises/registry';
import { installGlobalErrorHandler, onFatalError } from '@/lib/globalErrorHandler';
import { preloadAppImages } from '@/lib/preloadAssets';
import { getSessions } from '@/lib/sessionCache';
import { useOnboarding } from '@/store/onboarding';
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

  // Kick off warming the rank/achievement/streak icon cache immediately at
  // launch, in the background — see preloadAssets.ts for why this matters in
  // Expo Go specifically. Fire-and-forget: never gates the splash or blocks
  // the first screen.
  useEffect(() => {
    preloadAppImages();
    getSessions();
  }, []);

  // Check for remote exercise content (GitHub-hosted overrides/additions/
  // changelog) in the background — fire-and-forget, same as the image
  // preload above, never gates the splash or blocks the first screen. Any
  // failure (offline, unreachable, placeholder URL never filled in) just
  // leaves the app on whatever it already had — see registry.ts.
  useEffect(() => {
    startAutoRefresh();
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
  const hasOnboarded = useOnboarding((s) => s.hasOnboarded);
  const hasHydrated = useOnboarding((s) => s.hasHydrated);
  const setHasOnboarded = useOnboarding((s) => s.setHasOnboarded);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.surface.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* !hasHydrated renders nothing — solid black same as the splash,
            since the persisted onboarding flag hasn't loaded yet and showing
            either screen here could be wrong for a beat. */}
        {!hasHydrated ? null : !hasOnboarded ? (
          <OnboardingFlow onDone={() => setHasOnboarded(true)} />
        ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: t.surface.base },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="(tabs)" />
            {/* gestureEnabled: false on all four of these — each one holds a
                set/workout that hasn't been saved yet, and the iOS edge-swipe
                back gesture is easy to trigger by accident while just
                scrolling. The explicit BackButton/Alert flow already built
                into review/[id].tsx is the only way back on that screen; the
                other three don't even have a back button, so disabling the
                swipe here doesn't remove any real affordance, just an
                accidental one. */}
            <Stack.Screen
              name="workout/active"
              options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="workout/run"
              options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen name="workout/review/[id]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="workout/summary" options={{ gestureEnabled: false }} />
            <Stack.Screen name="exercise/[slug]" options={{ presentation: 'card' }} />
            <Stack.Screen name="settings" options={{ presentation: 'card' }} />
            {/* Was presentation:'modal' — pushing a 'card' screen (exercise
                detail) from inside a modal-presented screen is a known
                react-native-screens layering bug: the pushed screen renders
                BEHIND the modal instead of on top of it. search.tsx doesn't
                look or behave like a sheet (full BackButton page, no drag-
                to-dismiss), so there's no visual reason for it to be a modal
                in the first place — plain 'card' matches every other screen
                it navigates to/from. */}
            <Stack.Screen name="search" options={{ presentation: 'card' }} />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
