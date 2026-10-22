/**
 * When the memories reminders are planned (#2746). The reminders cover the next
 * two weeks of days with memories, so they are planned again whenever what they
 * depend on may have changed: the setting, its time and the app language
 * (Settings), the app coming to the foreground, and a finished sync pass
 * (foreground and background, `sync/run.ts`), which may bring new photos.
 */
import { AppState, type AppStateStatus } from "react-native";
import { t } from "i18next";
// Initialises i18next with the app's resources, also in a headless background run.
import "@/i18n";
import type { AppDatabase } from "@/db/types";
import { getMemoriesNotifPrefs, memoryDaysAhead } from "@/db/queries/memories";
import {
  cancelMemoriesReminder,
  hasNotificationPermission,
  planMemoriesReminders,
  requestNotificationPermission,
  scheduleMemoriesReminders,
  type ReminderContent,
} from "./notifications";

/** The reminder's text, in the app's current language. */
const reminderContent: ReminderContent = (reminder) => ({
  title: t("memories.notificationTitle"),
  body: t("memories.notificationBody", { count: reminder.yearCount }),
});

export type RescheduleOptions = {
  /** Ask for the notification permission when it is missing (only on a user action). */
  requestPermission?: boolean;
  now?: Date;
};

async function reschedule(db: AppDatabase, opts: RescheduleOptions): Promise<boolean> {
  const prefs = getMemoriesNotifPrefs(db);
  if (!prefs.enabled) {
    await cancelMemoriesReminder();
    return true;
  }
  const granted = opts.requestPermission ? await requestNotificationPermission() : await hasNotificationPermission();
  if (!granted) return false;
  const now = opts.now ?? new Date();
  const reminders = planMemoriesReminders(memoryDaysAhead(db, { today: now }), prefs, now);
  await scheduleMemoriesReminders(reminders, reminderContent);
  return true;
}

// One plan at a time: a cancel of one run between the schedules of another
// would drop reminders the newer plan still wants.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Cancel the memories reminders and schedule them again from the mirror and the
 * setting. With the reminder off it only cancels. False when the notification
 * permission is missing (then nothing is scheduled).
 */
export function rescheduleMemoriesReminders(db: AppDatabase, opts: RescheduleOptions = {}): Promise<boolean> {
  const run = queue.then(() => reschedule(db, opts));
  queue = run.catch(() => undefined);
  return run;
}

/** `rescheduleMemoriesReminders` for a trigger nobody waits on: a failure is dropped. */
export async function refreshMemoriesReminders(db: AppDatabase): Promise<void> {
  try {
    await rescheduleMemoriesReminders(db);
  } catch {
    // No native module or no database: the next trigger tries again.
  }
}

/**
 * Plan now, and again whenever the app comes to the foreground. Returns the
 * unsubscribe handle. App-only.
 */
export function registerMemoriesReminderTriggers(db: AppDatabase): () => void {
  void refreshMemoriesReminders(db);
  const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") void refreshMemoriesReminders(db);
  });
  return () => appStateSub.remove();
}
