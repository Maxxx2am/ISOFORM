import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { computeStreakDays } from '@/lib/insights';
import { listSessions } from '@/storage/db';

const REMINDER_KIND = 'isoform-workout-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type ReminderConfig = {
  enabled: boolean;
  reminders?: { weekdays: number[]; hour: number; minute: number; style: 'encouraging' | 'direct' }[];
  weekdays: number[];
  hour: number;
  minute: number;
  streakProtection: boolean;
  style: 'encouraging' | 'direct';
};

async function cancelIsoformReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.kind === REMINDER_KIND)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

/** Replaces only ISOFORM's local reminders, leaving other app notifications alone. */
export async function syncWorkoutReminders(config: ReminderConfig): Promise<boolean> {
  try {
    await cancelIsoformReminders();
    if (!config.enabled || config.weekdays.length === 0) return true;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('workout-reminders', {
        name: 'Workout reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;

    const sessions = config.streakProtection ? await listSessions().catch(() => []) : [];
    const streak = sessions.length > 0 ? computeStreakDays(sessions.map((session) => session.createdAt)) : 0;
    const streakCopy = streak >= 5;
    const reminders = config.reminders?.length ? config.reminders : [{ weekdays: config.weekdays, hour: config.hour, minute: config.minute, style: config.style }];
    await Promise.all(reminders.flatMap((reminder) => reminder.weekdays.map((weekday) => Notifications.scheduleNotificationAsync({
      content: {
        title: streakCopy ? `Keep your ${streak}-day streak alive` : reminder.style === 'direct' ? 'Workout time' : 'You showed up for yourself before',
        body: streakCopy ? 'One focused set is enough to keep it moving.' : reminder.style === 'direct' ? 'Your planned session is waiting.' : 'A few focused minutes is enough. Start when you are ready.',
        data: { kind: REMINDER_KIND, url: '/' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
         hour: reminder.hour,
         minute: reminder.minute,
        ...(Platform.OS === 'android' ? { channelId: 'workout-reminders' } : {}),
      },
    }))));
    return true;
  } catch {
    return false;
  }
}

export async function sendTestWorkoutReminder(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('workout-reminders', {
        name: 'Workout reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'ISOFORM reminders are working',
        body: 'Your workout reminder setup is ready.',
        data: { kind: REMINDER_KIND, test: true },
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
