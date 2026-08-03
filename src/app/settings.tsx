import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { BodyStatsFields } from '@/components/BodyStatsFields';
import { ListGroup, ListRow, SectionLabel } from '@/components/ListGroup';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { useExerciseRegistry } from '@/exercises/registry';
import { buildDebugInfo, deleteAllData, exportDataAsJson, importDataFromJson, resetSettingsAndProfile, seedDemoSessions, triggerTestCrash } from '@/lib/devTools';
import { formatRelativeDay } from '@/lib/format';
import { isICloudAvailable, pullFromCloud, pushToCloud, useSyncStatus } from '@/lib/icloudSync';

import { useOnboarding } from '@/store/onboarding';
import { useProfile } from '@/store/profile';
import { useSettings, type CameraFacing } from '@/store/settings';
import { useSubscription } from '@/store/subscription';
import { Feedback, Radius, Spacing } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function SettingsScreen() {
  const t = useTheme();
  const s = useSettings();
  const sub = useSubscription();
  const profile = useProfile();
  const [busy, setBusy] = useState<string | null>(null);
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
      <View style={styles.headerRow}>
        <BackButton />
        <Text variant="title">Settings</Text>
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
            subtitle="Unlock every exercise — the only real unlock switch right now"
            right={<Toggle value={sub.hasAllAccess} onChange={(v) => (v ? sub.grantAllAccess() : sub.revokeAllAccess())} />}
          />
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
  footer: { textAlign: 'center', marginTop: Spacing.xl },
});
