import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
};

/** Theme-aware safe-area container used by every screen. Forwards a ref to
 * the internal ScrollView (when `scroll`) so callers can e.g. scroll back to
 * top on tab focus — a no-op ref when `scroll` is false. */
export const Screen = forwardRef<ScrollView, ScreenProps>(function Screen(
  { children, scroll = false, padded = true, edges = ['top', 'left', 'right'], style },
  ref,
) {
  const t = useTheme();
  const inner = padded ? styles.padded : undefined;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.surface.base }]} edges={edges}>
      {/* Without this, a focused text input (body stats in onboarding or
          Settings) had nothing pushing content up out from under the
          keyboard — Android's own window resize mostly covers it, but iOS
          needs this explicitly. behavior="height" on Android instead of
          "padding" — "padding" there can fight the OS's own resize and
          double-compensate. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {scroll ? (
          <ScrollView
            ref={ref}
            contentContainerStyle={[inner, styles.scrollContent, style]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, inner, style]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  padded: { paddingHorizontal: Spacing.page },
  scrollContent: { paddingBottom: Spacing.xxl, gap: Spacing.md },
});
