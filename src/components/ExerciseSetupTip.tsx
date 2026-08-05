import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Text } from '@/components/Text';
import type { Exercise } from '@/exercises/types';
import { alpha, Brand, Ink, Radius, Spacing, Surface } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Props = {
  exercise: Exercise;
  onContinue: (dontShowAgain: boolean) => void;
};

export function ExerciseSetupTip({ exercise, onContinue }: Props) {
  const t = useTheme();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const isFront = exercise.view === 'front';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: t.surface.raised, borderColor: t.ink.hairlineStrong }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.directionRow}>
            <View style={styles.directionIcon}>
              {isFront ? (
                <Ionicons name="person-outline" size={48} color={t.accent.color} />
              ) : (
                <Ionicons name="body-outline" size={48} color={t.accent.color} />
              )}
            </View>
            <View style={styles.directionText}>
              <Text variant="heading">
                {isFront ? 'Face the camera' : 'Turn sideways'}
              </Text>
              <Text tone="secondary" style={{ marginTop: 2 }}>
                {isFront
                  ? 'Stand directly in front of the camera, whole body in frame.'
                  : 'Film your side profile so the camera can see your full body from head to toe.'}
              </Text>
            </View>
          </View>

          <View style={[styles.phoneHint, { backgroundColor: t.surface.sunken }]}>
            <Ionicons name="phone-portrait-outline" size={24} color={t.ink.secondary} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="secondary">
                Phone upright, {isFront ? '2\u20133 m away' : '2\u20134 m away'} at body height
              </Text>
              <Text variant="caption" tone="muted">
                Back camera works best for distance exercises
              </Text>
            </View>
          </View>

          <View style={[styles.setupBox, { borderColor: t.ink.hairline }]}>
            <View style={styles.setupHeader}>
              <Ionicons name="information-circle-outline" size={16} color={t.ink.secondary} />
              <Text variant="label" tone="secondary">
                Setup
              </Text>
            </View>
            <Text style={{ lineHeight: 20 }}>
              {exercise.setup ?? 'Get your whole body in frame.'}
            </Text>
          </View>

          <PrimaryButton
            label="Continue"
            variant="hero"
            onPress={() => onContinue(dontShowAgain)}
          />

          <Pressable
            onPress={() => setDontShowAgain((v) => !v)}
            style={styles.dismissRow}
          >
            <View style={[styles.checkbox, dontShowAgain && { backgroundColor: t.accent.color, borderColor: t.accent.color }]}>
              {dontShowAgain ? (
                <Ionicons name="checkmark" size={13} color={t.accent.onColor} />
              ) : null}
            </View>
            <Text variant="caption" tone="secondary">
              Don&apos;t show for {exercise.name}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: alpha(Surface.base, 0.82),
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    padding: Spacing.lg,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: alpha(Ink.primary, 0.24), marginBottom: Spacing.xs },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  directionIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: alpha(Brand.primary.color, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionText: {
    flex: 1,
  },
  phoneHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: 14,
  },
  setupBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dismissRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: alpha(Ink.primary, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
