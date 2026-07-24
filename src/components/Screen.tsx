import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
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

/** Theme-aware safe-area container used by every screen. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
}: ScreenProps) {
  const t = useTheme();
  const inner = padded ? styles.padded : undefined;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.surface.base }]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, styles.scrollContent, style]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, inner, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  padded: { paddingHorizontal: Spacing.page },
  scrollContent: { paddingBottom: Spacing.xxl, gap: Spacing.md },
});
