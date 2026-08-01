import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Share, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { buildDebugInfo, deleteAllData, exportDataAsJson, resetSettingsAndProfile, seedDemoSessions, triggerTestCrash } from '@/lib/devTools';
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg, useProfile } from '@/store/profile';
import { useSettings, type CameraFacing } from '@/store/settings';
import { useSubscription } from '@/store/subscription';
import { Accents, Feedback, Radius, Spacing, type AccentId } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function SettingsScreen() {
  const t = useTheme();
  const s = useSettings();
  const sub = useSubscription();
  const profile = useProfile();
  const [busy, setBusy] = useState<string | null>(null);

  const onExport = async () => {
    setBusy('export');
    try {
      const json = await exportDataAsJson();
      const uri = `${FileSystem.cacheDirectory}isoform-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(uri, json);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Export ISOFORM data' });
      } else {
        Alert.alert('Export ready', `Saved to ${uri}`);
      }
    } catch {
      Alert.alert('Export failed', 'Could not export your data. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const onDeleteAll = () => {
    Alert.alert(
      'Delete all data?',
      'This permanently removes every logged workout on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              await deleteAllData();
              Alert.alert('Done', 'All workout history has been deleted.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const onSeedDemo = async () => {
    setBusy('seed');
    try {
      const count = await seedDemoSessions();
      Alert.alert('Demo data added', `Inserted ${count} fake sessions to test Insights/Review with.`);
    } finally {
      setBusy(null);
    }
  };

  const onCopyDebugInfo = async () => {
    setBusy('debug');
    try {
      const info = await buildDebugInfo();
      await Share.share({ message: info });
    } finally {
      setBusy(null);
    }
  };

  const onResetSettings = () => {
    Alert.alert(
      'Reset settings & profile?',
      'Restores accent/coaching/body-stat preferences to their defaults. Your workout history is untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetSettingsAndProfile },
      ],
    );
  };

  const onTriggerCrash = () => {
    Alert.alert(
      'Trigger a test crash?',
      'Throws a real uncaught error so you can confirm the fatal-error screen looks right before shipping.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Crash now', style: 'destructive', onPress: triggerTestCrash },
      ],
    );
  };

  const appVersion = Constants.expoConfig?.version ?? '—';
  const deviceInfo = `${Device.modelName ?? 'Unknown device'} · ${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim();

  return (
    <Screen scroll>
      <View style={{ paddingTop: Spacing.md }}>
        <Text variant="title">Settings</Text>
      </View>

      {/* Accent picker — single row of 7 circles */}
      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Accent</SectionLabel>
        <View style={[styles.accentRow, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
          {(Object.keys(Accents) as AccentId[]).map((id) => {
            const selected = id === s.accent;
            const color = id === 'mono' ? t.ink.primary : Accents[id].color;
            const onColor = id === 'mono' ? t.surface.base : Accents[id].onColor;
            const label = Accents[id].label;
            return (
              <Pressable
                key={id}
                onPress={() => s.setAccent(id)}
                style={styles.accentCol}
              >
                <View
                  style={[
                    styles.accentDot,
                    {
                      backgroundColor: color,
                      borderColor: selected ? t.ink.primary : 'transparent',
                      borderWidth: selected ? 2.5 : 0,
                    },
                  ]}
                >
                  {selected ? <Ionicons name="checkmark" size={12} color={onColor} /> : null}
                </View>
                <Text
                  variant="label"
                  tone={selected ? 'primary' : 'muted'}
                  style={styles.accentLabel}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Workout</SectionLabel>
        <ListGroup>
          <ListRow
            title="Countdown"
            subtitle="Delay before tracking starts"
            right={
              <Segmented
                options={[
                  { label: '3s', value: 3 },
                  { label: '5s', value: 5 },
                  { label: '10s', value: 10 },
                ]}
                value={s.countdownSec}
                onChange={s.setCountdownSec}
              />
            }
          />
          <ListRow
            title="Camera"
            right={
              <Segmented<CameraFacing>
                options={[
                  { label: 'Front', value: 'front' },
                  { label: 'Back', value: 'back' },
                ]}
                value={s.cameraFacing}
                onChange={s.setCameraFacing}
              />
            }
          />
          <ListRow
            title="Mirror front camera"
            right={<Toggle value={s.mirrorFrontCamera} onChange={s.setMirrorFrontCamera} />}
          />
          <ListRow
            title="Goal alert"
            subtitle="How a workout goal is announced"
            right={
              <Segmented<'sound' | 'voice'>
                options={[
                  { label: 'Sound', value: 'sound' },
                  { label: 'Voice', value: 'voice' },
                ]}
                value={s.workoutAlertStyle}
                onChange={s.setWorkoutAlertStyle}
              />
            }
          />
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Body stats</SectionLabel>
        <ListGroup>
          <ListRow
            title="Units"
            right={
              <Segmented<'metric' | 'imperial'>
                options={[
                  { label: 'Metric', value: 'metric' },
                  { label: 'Imperial', value: 'imperial' },
                ]}
                value={profile.units}
                onChange={profile.setUnits}
              />
            }
          />
          <ListRow
            title="Sex"
            subtitle="Also used for the rank estimate"
            right={
              <Segmented<'male' | 'female' | 'unspecified'>
                options={[
                  { label: 'Male', value: 'male' },
                  { label: 'Female', value: 'female' },
                  { label: 'Skip', value: 'unspecified' },
                ]}
                value={profile.sex}
                onChange={profile.setSex}
              />
            }
          />
        </ListGroup>
        <BodyStatsCard />
        <Text variant="caption" tone="muted" style={{ marginTop: Spacing.xs }}>
          Used to estimate your calisthenics rank in Insights — optional, and never required.
        </Text>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Coaching</SectionLabel>
        <ListGroup>
          <ListRow
            title="Voice coach"
            subtitle="Speaks the key form fixes out loud"
            right={<Toggle value={s.voiceCoach} onChange={s.setVoiceCoach} />}
          />
          <ListRow
            title="Rep sound"
            subtitle="Ding on every counted rep"
            right={<Toggle value={s.repDing} onChange={s.setRepDing} />}
          />
          <ListRow
            title="Haptic form cues"
            subtitle="Buzz when your form slips"
            right={<Toggle value={s.hapticCues} onChange={s.setHapticCues} />}
          />
          <ListRow
            title="Haptic per rep"
            subtitle="Tick on every counted rep"
            right={<Toggle value={s.repHaptics} onChange={s.setRepHaptics} />}
          />
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Backup & data</SectionLabel>
        <ListGroup>
          <ListRow
            title="Export my data"
            subtitle="Share your full workout history as a JSON file"
            onPress={busy ? undefined : onExport}
            right={busy === 'export' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="share-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="iCloud sync"
            subtitle="Back up history across your devices — coming soon"
            right={<Switch value={false} disabled trackColor={{ true: Feedback.good, false: t.surface.pressed }} thumbColor="#FFFFFF" />}
          />
          <ListRow
            title="Delete all data"
            subtitle="Permanently erase every logged workout"
            onPress={busy ? undefined : onDeleteAll}
            right={busy === 'delete' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="trash-outline" size={18} color={Feedback.bad} />}
          />
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Legal</SectionLabel>
        <ListGroup>
          <ListRow title="Terms of Use" onPress={() => router.push('/legal/terms')} chevron />
          <ListRow title="Privacy Policy" onPress={() => router.push('/legal/privacy')} chevron />
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Privacy</SectionLabel>
        <ListGroup>
          <ListRow
            title="Everything stays on your phone"
            subtitle="No account. No cloud. Pose tracking and video never leave the device."
          />
        </ListGroup>
      </View>

      {/* Dev / testing tools */}
      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Developer</SectionLabel>
        <ListGroup>
          <ListRow
            title="All Access"
            subtitle="Dev bypass — toggles unlock without payment. Ship with this OFF."
            right={<Toggle value={sub.hasAllAccess} onChange={(v) => (v ? sub.grantAllAccess() : sub.revokeAllAccess())} />}
          />
          <ListRow
            title="Seed demo data"
            subtitle="Add 2 weeks of fake sessions to test Insights/Review"
            onPress={busy ? undefined : onSeedDemo}
            right={busy === 'seed' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="flask-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Copy debug info"
            subtitle="Version, device, session counts — for a bug report"
            onPress={busy ? undefined : onCopyDebugInfo}
            right={busy === 'debug' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="clipboard-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Reset settings & profile"
            subtitle="Back to defaults — workout history is kept"
            onPress={onResetSettings}
            right={<Ionicons name="refresh-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Trigger test crash"
            subtitle="Verify the fatal-error screen before shipping"
            onPress={onTriggerCrash}
            right={<Ionicons name="skull-outline" size={18} color={Feedback.bad} />}
          />
          <ListRow title="App version" right={<Text variant="caption" tone="muted">{appVersion}</Text>} />
          <ListRow title="Device" right={<Text variant="caption" tone="muted" numberOfLines={1}>{deviceInfo || '—'}</Text>} />
        </ListGroup>
      </View>

      <Text variant="caption" tone="muted" style={styles.footer}>
        ISOFORM v{appVersion}
      </Text>
      {/* Deliberately understated — this is a paid app, not a support billboard.
          Same universal Ko-fi page used across ISOMTRIC/FUELS. */}
      <Pressable onPress={() => Linking.openURL('https://www.tiktok.com/@maxxxdev')} hitSlop={8}>
        <Text variant="caption" tone="muted" style={[styles.footer, { marginTop: 2 }]}>
          Contact support
        </Text>
      </Pressable>
      <Pressable onPress={() => Linking.openURL('https://ko-fi.com/maxxxdev')} hitSlop={8}>
        <Text variant="caption" tone="muted" style={[styles.footer, { marginTop: 2 }]}>
          Support the developer
        </Text>
      </Pressable>
    </Screen>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: Feedback.good, false: t.surface.pressed }}
      thumbColor="#FFFFFF"
    />
  );
}

function BodyStatsCard() {
  const t = useTheme();
  const profile = useProfile();
  const imperial = profile.units === 'imperial';

  const heightDisplay = profile.heightCm != null ? cmToFeetInches(profile.heightCm) : null;
  const weightDisplay = profile.weightKg != null ? Math.round(kgToLb(profile.weightKg)) : null;

  return (
    <View style={[styles.bodyCard, { backgroundColor: t.surface.raised, borderColor: t.ink.hairline }]}>
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
          Height
        </Text>
        {imperial ? (
          <View style={{ flexDirection: 'row', gap: Spacing.sm, flex: 1 }}>
            <NumberField
              value={heightDisplay?.feet ?? null}
              placeholder="ft"
              style={{ flex: 1 }}
              onChange={(feet) => {
                const inches = heightDisplay?.inches ?? 0;
                profile.setHeightCm(feet != null ? feetInchesToCm(feet, inches) : null);
              }}
            />
            <NumberField
              value={heightDisplay?.inches ?? null}
              placeholder="in"
              style={{ flex: 1 }}
              onChange={(inches) => {
                const feet = heightDisplay?.feet ?? 0;
                profile.setHeightCm(inches != null ? feetInchesToCm(feet, inches) : null);
              }}
            />
          </View>
        ) : (
          <NumberField
            value={profile.heightCm != null ? Math.round(profile.heightCm) : null}
            placeholder="cm"
            style={{ flex: 1 }}
            onChange={(cm) => profile.setHeightCm(cm)}
          />
        )}
      </View>
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
          Weight
        </Text>
        <NumberField
          value={imperial ? weightDisplay : profile.weightKg != null ? Math.round(profile.weightKg) : null}
          placeholder={imperial ? 'lb' : 'kg'}
          style={{ flex: 1 }}
          onChange={(v) => profile.setWeightKg(v != null ? (imperial ? lbToKg(v) : v) : null)}
        />
      </View>
      <View style={styles.bodyRow}>
        <Text variant="label" tone="muted" style={styles.bodyLabel}>
          Age
        </Text>
        <NumberField
          value={profile.age}
          placeholder="years"
          style={{ flex: 1 }}
          onChange={(age) => profile.setAge(age)}
        />
      </View>
    </View>
  );
}

function NumberField({
  value,
  placeholder,
  onChange,
  style,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
  style?: object;
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

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: t.surface.sunken }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on && { backgroundColor: t.ink.primary }]}
          >
            <Text variant="caption" style={{ color: on ? t.surface.base : t.ink.secondary }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bodyCard: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  bodyLabel: { width: 60 },
  accentRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  accentCol: { alignItems: 'center', gap: 6 },
  accentDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accentLabel: { fontSize: 9, letterSpacing: 0.5 },
  segment: { flexDirection: 'row', borderRadius: Radius.pill, padding: 2, gap: 2 },
  segItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.pill },
  footer: { textAlign: 'center', marginTop: Spacing.xl },
});