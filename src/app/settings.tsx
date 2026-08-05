import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';

import { Atmosphere } from '@/components/Atmosphere';
import { BodyStatsFields } from '@/components/BodyStatsFields';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { useExerciseRegistry } from '@/exercises/registry';
import { buildDebugInfo, deleteAllData, exportDataAsJson, importDataFromJson, resetSettingsAndProfile, seedDemoSessions, triggerTestCrash } from '@/lib/devTools';
import { formatRelativeDay } from '@/lib/format';
import { isICloudAvailable, pullFromCloud, pushToCloud, useSyncStatus } from '@/lib/icloudSync';
import { syncWorkoutReminders } from '@/lib/reminders';

import { useOnboarding } from '@/store/onboarding';
import { useProfile } from '@/store/profile';
import { useSettings, type CameraFacing, type WorkoutReminder } from '@/store/settings';
import { useSubscription } from '@/store/subscription';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function SettingsScreen() {
  const t = useTheme();
  const s = useSettings();
  const sub = useSubscription();
  const profile = useProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [draftReminderTime, setDraftReminderTime] = useState({ hour: s.reminderHour, minute: s.reminderMinute });
  const syncStatus = useSyncStatus();

  const onToggleICloud = async (enabled: boolean) => {
    if (enabled && !isICloudAvailable()) {
      Alert.alert('iCloud unavailable', 'Sign into iCloud on this device and use a development or App Store build. iCloud does not work in Expo Go.');
      return;
    }
    s.setICloudSyncEnabled(enabled);
    if (enabled) {
      await pullFromCloud();
      await pushToCloud();
    }
  };

  const onSyncNow = async () => {
    if (!s.iCloudSyncEnabled || !isICloudAvailable()) {
      Alert.alert('iCloud unavailable', 'Turn on iCloud backup and make sure you are signed into iCloud on this device.');
      return;
    }
    setBusy('icloud');
    try {
      await pullFromCloud();
      await pushToCloud();
    } finally {
      setBusy(null);
    }
  };

  const reminderConfig = () => ({
    enabled: s.reminderEnabled,
    reminders: s.reminders,
    weekdays: s.reminderWeekdays,
    hour: s.reminderHour,
    minute: s.reminderMinute,
    streakProtection: s.streakReminderEnabled,
    style: s.reminderStyle,
  });

  const updateReminders = async (reminders: WorkoutReminder[]) => {
    s.setReminders(reminders);
    if (s.reminderEnabled) await syncWorkoutReminders({ ...reminderConfig(), reminders });
  };

  const onReminderEnabled = async (enabled: boolean) => {
    s.setReminderEnabled(enabled);
    const ok = await syncWorkoutReminders({ ...reminderConfig(), enabled });
    if (!ok && enabled) {
      s.setReminderEnabled(false);
      Alert.alert('Notifications unavailable', 'Allow notifications in your device settings to use workout reminders.');
    }
  };

  const onReminderWeekday = async (weekday: number, reminderId = editingReminderId) => {
    if (!reminderId) return;
    const reminder = s.reminders.find((item) => item.id === reminderId);
    if (!reminder) return;
    const weekdays = reminder.weekdays.includes(weekday)
      ? reminder.weekdays.filter((day) => day !== weekday)
      : [...reminder.weekdays, weekday].sort((a, b) => a - b);
    if (weekdays.length === 0) return;
    await updateReminders(s.reminders.map((item) => item.id === reminderId ? { ...item, weekdays } : item));
  };

  const onReminderTime = async (hour: number, minute: number) => {
    if (!editingReminderId) return;
    await updateReminders(s.reminders.map((item) => item.id === editingReminderId ? { ...item, hour, minute } : item));
  };

  const finishReminderTimeEdit = async () => {
    await onReminderTime(draftReminderTime.hour, draftReminderTime.minute);
    setEditingReminderId(null);
  };

  // Deep link from the "complete your profile" nudge on the Profile tab
  // (and from onboarding's skip path) — /settings?section=bodyStats lands
  // here scrolled straight to the right section instead of making someone
  // hunt for it.
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [bodyStatsY, setBodyStatsY] = useState<number | null>(null);
  useEffect(() => {
    if (section === 'bodyStats' && bodyStatsY != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, bodyStatsY - Spacing.md), animated: true });
    }
  }, [section, bodyStatsY]);

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

  const onImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      const json = await FileSystem.readAsStringAsync(uri);
      const { imported, skipped } = await importDataFromJson(json);
      Alert.alert(
        'Import done',
        `Imported ${imported} session${imported === 1 ? '' : 's'}.${skipped > 0 ? ` ${skipped} already existed and w${skipped === 1 ? 'as' : 'ere'} skipped.` : ''}`,
      );
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Could not read the file.');
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
      'Restores coaching/body-stat preferences to their defaults. Your workout history is untouched.',
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
    <Screen scroll ref={scrollRef}>
      <Stack.Screen options={{ headerShown: false }} />
      <Atmosphere />
      <PageHeader eyebrow="PERSONALIZE" title="Your setup" subtitle="Tune the camera, coaching, reminders, and personal data behind your feedback." />

      <View style={[styles.settingsIntro, { backgroundColor: t.surface.raised, borderColor: t.ink.hairlineStrong }]}>
        <View style={[styles.settingsIntroIcon, { backgroundColor: `${t.accent.color}18` }]}>
          <Ionicons name="options-outline" size={24} color={t.accent.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading">Make training feel like yours</Text>
          <Text variant="caption" tone="secondary" style={{ marginTop: Spacing.xs }}>A few calm controls for your practice.</Text>
        </View>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Testing access</SectionLabel>
        <ListGroup>
          <ListRow
            title="All Access"
            subtitle={sub.hasAllAccess ? 'On — every exercise is unlocked' : 'Off — only the free exercise is available'}
            right={<Toggle value={sub.hasAllAccess} onChange={(v) => (v ? sub.grantAllAccess() : sub.revokeAllAccess())} />}
          />
        </ListGroup>
        <Text variant="caption" tone="muted" style={{ marginTop: Spacing.xs, marginLeft: 4 }}>
          Testing control only. App Store purchases are not connected yet.
        </Text>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Reminders</SectionLabel>
        <ListGroup>
          <ListRow
            title="Workout reminders"
            subtitle={s.reminderEnabled ? 'On — choose your days and time below' : 'Off — ISOFORM will not notify you'}
            right={<Toggle value={s.reminderEnabled} onChange={onReminderEnabled} />}
          />
        </ListGroup>
        {s.reminderEnabled ? s.reminders.map((reminder) => {
          const editing = editingReminderId === reminder.id;
          return (
            <View
              key={reminder.id}
              style={[styles.reminderPanel, { backgroundColor: t.surface.sunken, borderColor: t.ink.hairline }]}
            >
              <View style={styles.reminderTitleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="body" style={{ fontWeight: '700' }}>Training reminder</Text>
                  <Text variant="caption" tone="muted">
                    {reminder.weekdays.length} day{reminder.weekdays.length === 1 ? '' : 's'} · {new Date(2000, 0, 1, reminder.hour, reminder.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
                {s.reminders.length > 1 ? <Pressable onPress={() => updateReminders(s.reminders.filter((item) => item.id !== reminder.id))}><Text variant="caption" style={{ color: Feedback.bad }}>Remove</Text></Pressable> : null}
              </View>
              <Text variant="label" tone="muted">DAYS</Text>
              <View style={styles.dayRow}>
                {[{ label: 'S', value: 1 }, { label: 'M', value: 2 }, { label: 'T', value: 3 }, { label: 'W', value: 4 }, { label: 'T', value: 5 }, { label: 'F', value: 6 }, { label: 'S', value: 7 }].map((day) => {
                  const selected = reminder.weekdays.includes(day.value);
                  return <Pressable key={`${day.label}-${day.value}`} onPress={() => { setEditingReminderId(reminder.id); void onReminderWeekday(day.value, reminder.id); }} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.dayButton, { backgroundColor: selected ? t.accent.color : t.surface.sunken, borderColor: selected ? t.accent.color : t.ink.hairline }]}><Text variant="caption" style={{ color: selected ? t.accent.onColor : t.ink.secondary, fontWeight: '700' }}>{day.label}</Text></Pressable>;
                })}
              </View>
              <Text variant="label" tone="muted">TIME</Text>
              {editing ? <>
                <DateTimePicker value={new Date(2000, 0, 1, draftReminderTime.hour, draftReminderTime.minute)} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minuteInterval={5} onChange={(_, value) => { if (!value) return; const next = { hour: value.getHours(), minute: value.getMinutes() }; setDraftReminderTime(next); if (Platform.OS !== 'ios') { void onReminderTime(next.hour, next.minute); setEditingReminderId(null); } }} style={styles.timePicker} />
                {Platform.OS === 'ios' ? <Pressable onPress={finishReminderTimeEdit} style={[styles.testReminder, { borderColor: t.ink.hairline }]}><Text variant="caption" tone="accent">Done</Text></Pressable> : null}
              </> : <Pressable onPress={() => { setEditingReminderId(reminder.id); setDraftReminderTime({ hour: reminder.hour, minute: reminder.minute }); }} style={[styles.timeSummary, { borderColor: t.ink.hairline }]}><Text variant="body">{new Date(2000, 0, 1, reminder.hour, reminder.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text><Text variant="caption" tone="accent">Edit</Text></Pressable>}
              <Text variant="label" tone="muted">MESSAGE STYLE</Text>
              <Segmented options={[{ label: 'Encouraging', value: 'encouraging' as const }, { label: 'Direct', value: 'direct' as const }]} value={reminder.style} onChange={(value) => void updateReminders(s.reminders.map((item) => item.id === reminder.id ? { ...item, style: value } : item))} />
              <ListRow
                title="Protect my streak"
                subtitle="Only remind me when you have a 5+ day streak"
                right={<Toggle value={s.streakReminderEnabled} onChange={async (value) => { s.setStreakReminderEnabled(value); await syncWorkoutReminders({ ...reminderConfig(), streakProtection: value }); }} />}
              />
            </View>
          );
        }) : null}
        {s.reminderEnabled ? <Pressable onPress={() => void updateReminders([...s.reminders, { id: String(Date.now()), weekdays: [2], hour: 18, minute: 0, style: 'encouraging' }])} style={styles.addReminder}><Ionicons name="add" size={16} color={t.accent.color} /><Text variant="caption" tone="accent">Add reminder</Text></Pressable> : null}
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
        </ListGroup>
      </View>

      <View style={{ marginTop: Spacing.lg }} onLayout={(e) => setBodyStatsY(e.nativeEvent.layout.y)}>
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
        <BodyStatsFields />
        <Text variant="caption" tone="muted" style={{ marginTop: Spacing.xs }}>
          Used to estimate your calisthenics rank in Insights — optional, and never required.
        </Text>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Coaching</SectionLabel>
        <ListGroup>
          <ListRow
            title="Rep sound"
            subtitle="Ding on every counted rep"
            right={<Toggle value={s.repDing} onChange={s.setRepDing} />}
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
            title="iCloud backup"
            subtitle={
              !s.iCloudSyncEnabled
                ? 'Back up settings and recent workout history, not videos'
                : syncStatus.syncing
                  ? 'Syncing…'
                  : syncStatus.lastSyncedAt
                    ? `Synced ${formatRelativeDay(syncStatus.lastSyncedAt)}`
                    : 'On — waiting for first sync'
            }
            right={<Switch value={s.iCloudSyncEnabled} onValueChange={onToggleICloud} trackColor={{ true: Feedback.good, false: t.surface.pressed }} thumbColor="#FFFFFF" />}
          />
          <ListRow
            title="Sync now"
            subtitle="Restore or back up your latest workout data"
            onPress={busy ? undefined : onSyncNow}
            right={busy === 'icloud' ? <ActivityIndicator size="small" color={t.ink.muted} /> : <Ionicons name="sync-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Export my data"
            subtitle="Share your full workout history as a JSON file"
            onPress={busy ? undefined : onExport}
            right={busy === 'export' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="share-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Import data"
            subtitle="Restore sessions from a previous export"
            onPress={onImport}
            right={<Ionicons name="download-outline" size={18} color={t.ink.muted} />}
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
        <SectionLabel>Content updates</SectionLabel>
        <ContentUpdatesWidget />
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Legal</SectionLabel>
        <ListGroup>
          <ListRow title="Terms of Use" onPress={() => router.push('/legal/terms')} chevron />
          <ListRow title="Privacy Policy" onPress={() => router.push('/legal/privacy')} chevron />
        </ListGroup>
      </View>

      {/* Dev / testing tools stay out of production builds. */}
      {__DEV__ ? <View style={{ marginTop: Spacing.lg }}>
        <SectionLabel>Developer</SectionLabel>
        <ListGroup>
          <ListRow
            title="Seed demo data"
            subtitle="Add 2 weeks of fake sessions to test Insights/Review"
            onPress={busy ? undefined : onSeedDemo}
            right={busy === 'seed' ? <Text variant="caption" tone="muted">Working…</Text> : <Ionicons name="flask-outline" size={18} color={t.ink.muted} />}
          />
          <ListRow
            title="Replay onboarding"
            subtitle="Show the first-run welcome flow again on next app launch"
            onPress={() => {
              useOnboarding.getState().setHasOnboarded(false);
              Alert.alert('Done', 'Reload the app to see the onboarding flow.');
            }}
            right={<Ionicons name="refresh-outline" size={18} color={t.ink.muted} />}
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
      </View> : null}

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

function ContentUpdatesWidget() {
  const t = useTheme();
  const registry = useExerciseRegistry();
  const latest = registry.changelog.length > 0
    ? registry.changelog.slice().sort((a, b) => b.version - a.version)[0]
    : null;
  const hasNewContent = registry.remoteVersion > registry.lastSeenVersion;
  const lastChecked = registry.lastCheckedAt
    ? formatRelativeDay(registry.lastCheckedAt)
    : 'Never';
  const [justChecked, setJustChecked] = useState(false);

  const onRefresh = async () => {
    await registry.refresh();
    setJustChecked(true);
    setTimeout(() => setJustChecked(false), 3000);
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.ink.hairline,
        borderRadius: Radius.md,
        backgroundColor: t.surface.raised,
        padding: Spacing.md,
        gap: Spacing.sm,
      }}
    >
      {registry.refreshing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <ActivityIndicator size="small" color={t.ink.muted} />
          <Text variant="caption" tone="secondary">Checking for updates…</Text>
        </View>
      ) : latest ? (
        <View style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {hasNewContent ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: Feedback.good }} /> : null}
            <Text variant="caption" tone="muted">{latest.date}</Text>
          </View>
          <Text variant="body" style={{ fontWeight: '700', color: t.ink.primary }}>{latest.title}</Text>
          <Text variant="caption" tone="secondary">{latest.body}</Text>
        </View>
      ) : (
        <View style={{ gap: 3 }}>
          <Text variant="body" style={{ fontWeight: '700', color: t.ink.primary }}>No updates yet</Text>
          <Text variant="caption" tone="secondary">
            Exercise fixes and additions will appear here once the remote file is set up.
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <Text variant="caption" tone="muted" style={{ flex: 1, marginRight: Spacing.sm }}>
          {justChecked ? 'No new updates found' : registry.lastCheckedAt ? `Checked ${lastChecked}` : 'Not checked yet'} · auto on launch + WiFi
        </Text>
        <Pressable
          hitSlop={8}
          onPress={onRefresh}
          disabled={registry.refreshing}
          style={({ pressed }) => [
            { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill, backgroundColor: t.surface.sunken, opacity: registry.refreshing ? 0.4 : 1 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="refresh" size={15} color={t.ink.secondary} />
        </Pressable>
      </View>
    </View>
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

const styles = StyleSheet.create({
  headerRow: { paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  settingsIntro: { marginTop: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1 },
  settingsIntroIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  reminderPanel: { marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.sm },
  reminderTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.xs },
  dayButton: { width: 34, height: 34, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  timePicker: { alignSelf: 'center' },
  timeSummary: { alignSelf: 'center', minWidth: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1 },
  testReminder: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1 },
  addReminder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  footer: { textAlign: 'center', marginTop: Spacing.xl },
});
