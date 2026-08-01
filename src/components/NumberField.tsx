import { useEffect, useState } from 'react';
import { TextInput, type TextStyle } from 'react-native';

import { Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Plain numeric text field used anywhere body stats are entered (Settings,
 * onboarding) — one shared component so both stay visually/behaviorally identical. */
export function NumberField({
  value,
  placeholder,
  onChange,
  accessibilityLabel,
  style,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
  accessibilityLabel?: string;
  style?: TextStyle;
}) {
  const t = useTheme();
  const [text, setText] = useState(value != null ? String(value) : '');
  // Resync when the underlying value changes for a reason OTHER than our own
  // typing — async store hydration on app start, or switching the units
  // toggle (which recomputes this same field's converted display value).
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel ?? placeholder}
      value={text}
      onChangeText={(v) => {
        setText(v);
        if (v.trim() === '') {
          onChange(null);
          return;
        }
        const n = Number(v);
        if (!Number.isNaN(n) && n >= 0) onChange(n);
      }}
      placeholder={placeholder}
      placeholderTextColor={t.ink.muted}
      keyboardType="number-pad"
      style={[
        { height: 40, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.sm, color: t.ink.primary, borderColor: t.ink.hairline },
        style,
      ]}
    />
  );
}
