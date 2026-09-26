/**
 * Local (no-push) memories reminder (doc 05 §Memories, doc 03 §7). A single
 * daily scheduled notification that deep-links to the memories screen. Uses only
 * expo-notifications' local scheduling — F-Droid-compatible, no FCM. The
 * enable/time preference lives in app_meta (db/queries/memories).
 */
import * as Notifications from "expo-notifications";

/** Stable identifier so re-scheduling replaces (not duplicates) the reminder. */
export const MEMORIES_NOTIFICATION_ID = "memories-daily";

/** Deep link the notification tap resolves to. */
export const MEMORIES_DEEP_LINK = "/memories";

/** Cancel any scheduled memories reminder. */
export async function cancelMemoriesReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(MEMORIES_NOTIFICATION_ID);
  } catch {
    // no scheduled notification / no native module — safe to ignore
  }
}

/**
 * Schedule (or reschedule) the daily reminder at the given local time. Requests
 * permission first; returns false if permission was denied. i18n strings are
 * passed in so this module stays UI-agnostic.
 */
export async function scheduleMemoriesReminder(
  hour: number,
  minute: number,
  content: { title: string; body: string }
): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  let granted = perms.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return false;

  await cancelMemoriesReminder();
  await Notifications.scheduleNotificationAsync({
    identifier: MEMORIES_NOTIFICATION_ID,
    content: { title: content.title, body: content.body, data: { url: MEMORIES_DEEP_LINK } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
  return true;
}
