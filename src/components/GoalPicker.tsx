import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useState } from 'react';

import { Text } from '@/components/Text';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/**
 * Bottom sheet: pick one or more saved goal checkpoints for an exercise (or
 * type new ones, remembered as new presets). Multiple checkpoints matter for
 * a long hold — e.g. handstand at 30s, 60s, 90s — each announced as you pass
 * it, so you know where you are mid-set instead of a single end target.
 * Shared by the workout builder and the solo Train flow's goal prompt so both
 * feel identical and "your usual numbers" carry across both.
 */
export function GoalPickerSheet({
  visible,
  title,
  subtitle,
  presets,
  unit,
  initialValues,
  onConfirm,
  onClose,
  skipLabel,
  onSkip,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  presets: number[];
  unit: string;
  initialValues?: number[];
  onConfirm: (values: number[]) => void;
  onClose: () => void;
  /** Optional secondary action, e.g. "Skip — just train" (no goal at all). */
  skipLabel?: string;
  onSkip?: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={[styles.sheet, { backgroundColor: t.surface.base, borderColor: t.ink.hairline }]}>
            <Text variant="heading" style={{ textAlign: 'center' }}>
              {title}
            </Text>
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {subtitle}
            </Text>
            {/* key resets the picker's selection each time it's reopened for a
                different step/exercise, instead of carrying stale taps over. */}
            <GoalPicker key={title} presets={presets} unit={unit} initialValues={initialValues} onConfirm={onConfirm} />
            {skipLabel && onSkip ? (
              <Pressable onPress={onSkip} style={{ marginTop: Spacing.xs }}>
                <Text tone="secondary">{skipLabel}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Multi-select chips of saved presets + add-your-own values, then confirm. */
export function GoalPicker({
  presets,
  unit,
  initialValues = [],
  onConfirm,
}: {
  presets: number[];
  unit: string;
  initialValues?: number[];
  onConfirm: (values: number[]) => void;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<number[]>(initialValues);
  const [custom, setCustom] = useState('');

  const toggle = (v: number) => setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v].sort((a, b) => a - b)));

  const addCustom = () => {
    const n = parseInt(custom, 10);
    if (!Number.isNaN(n) && n > 0) {
      toggle(n);
      setCustom('');
    }
  };

  const confirmLabel =
    selected.length === 0 ? 'Select a checkpoint' : selected.length === 1 ? 'Set goal' : `Set ${selected.length} checkpoints`;

  return (
    <View style={{ gap: Spacing.md, width: '100%' }}>
      {presets.length > 0 ? (
        <View style={styles.chipRow}>
          {presets.map((v) => {
            const on = selected.includes(v);
            return (
              <Pressable
                key={v}
                onPress={() => toggle(v)}
                style={[
                  styles.chip,
                  { borderColor: on ? Feedback.good : t.ink.hairline, backgroundColor: on ? 'rgba(48,209,88,0.15)' : t.surface.raised },
                ]}
              >
                {on ? <Ionicons name="checkmark" size={14} color={Feedback.good} /> : null}
                <Text variant="body" style={on ? { color: Feedback.good } : undefined}>
                  {v}
                  {unit}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.customRow}>
        <TextInput
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={addCustom}
          placeholder="Add a value"
          placeholderTextColor={t.ink.muted}
          keyboardType="number-pad"
          style={[styles.customInput, { color: t.ink.primary, borderColor: t.ink.hairline }]}
        />
        <Pressable onPress={addCustom} style={[styles.addBtn, { borderColor: t.ink.hairline, backgroundColor: t.surface.raised }]}>
          <Text variant="heading">Add</Text>
        </Pressable>
      </View>
      {selected.length > 0 ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {selected.map((v) => `${v}${unit}`).join(' · ')}
        </Text>
      ) : null}
      <Pressable
        onPress={() => selected.length > 0 && onConfirm(selected)}
        disabled={selected.length === 0}
        style={[styles.confirmBtn, { backgroundColor: selected.length > 0 ? t.ink.primary : t.surface.sunken }]}
      >
        <Text variant="heading" style={{ color: selected.length > 0 ? t.surface.base : t.ink.muted }}>
          {confirmLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  customRow: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  customInput: { flex: 1, height: 44, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md },
  addBtn: { paddingHorizontal: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirmBtn: { width: '100%', paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
