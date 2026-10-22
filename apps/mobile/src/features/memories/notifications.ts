/**
 * Local (no-push) memories reminder (doc 05 §Memories, doc 03 §7). One
 * notification per coming day that has memories, at the chosen time, which
 * deep-links to the memories screen (#2746). Uses only expo-notifications'
 * local scheduling — F-Droid-compatible, no FCM. The enable/time preference
 * lives in app_meta (db/queries/memories); `reminders.ts` decides when to plan.
 */
import * as Notifications from "expo-notifications";
import type { MemoryDay } from "@/db/queries/memories";

/**
 * Every memories reminder's identifier starts with this. The day is part of the
 * id, so scheduling a day again replaces its reminder instead of adding one.
 * It also covers "memories-daily", the single repeating reminder of before.
 */
export const MEMORIES_NOTIFICATION_PREFIX = "memories-";

/** Deep link the notification tap resolves to. */
export const MEMORIES_DEEP_LINK = "/memories";

/** A reminder to schedule: its id, when it fires, and the memories it names. */
export type MemoriesReminder = {
  id: string;
  date: Date;
  photoCount: number;
  yearCount: number;
};

/** What a reminder says. i18n stays with the caller, so this module is UI-agnostic. */
export type ReminderContent = (reminder: MemoriesReminder) => { title: string; body: string };

/** "memories-YYYY-MM-DD" for the local day of `day`. */
export function memoriesNotificationId(day: Date): string {
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${MEMORIES_NOTIFICATION_PREFIX}${day.getFullYear()}-${mm}-${dd}`;
}

/**
 * The reminders for `days`: one at `hour:minute` local time on each day with
 * memories, leaving out a time that has already passed (today's, once it is
 * later than the reminder time).
 */
export function planMemoriesReminders(
  days: readonly MemoryDay[],
  time: { hour: number; minute: number },
  now: Date
): MemoriesReminder[] {
  return days
    .filter((d) => d.photoCount > 0)
    .map((d) => ({
      id: memoriesNotificationId(d.day),
      date: new Date(d.day.getFullYear(), d.day.getMonth(), d.day.getDate(), time.hour, time.minute),
      photoCount: d.photoCount,
      yearCount: d.yearCount,
    }))
    .filter((r) => r.date.getTime() > now.getTime());
}

/** Cancel every scheduled memories reminder. */
export async function cancelMemoriesReminder(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((n) => n.identifier.startsWith(MEMORIES_NOTIFICATION_PREFIX));
    await Promise.all(ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch {
    // no scheduled notification / no native module — safe to ignore
  }
}

/** Whether local notifications may be shown, without asking. */
export async function hasNotificationPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/** Whether local notifications may be shown, asking the user when not yet. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (await hasNotificationPermission()) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Replace the scheduled memories reminders with `reminders`. */
export async function scheduleMemoriesReminders(
  reminders: readonly MemoriesReminder[],
  content: ReminderContent
): Promise<void> {
  await cancelMemoriesReminder();
  for (const reminder of reminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { ...content(reminder), data: { url: MEMORIES_DEEP_LINK } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.date },
    });
  }
}
