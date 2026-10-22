import * as Notifications from "expo-notifications";
import { PermissionStatus } from "expo";
import { AppState } from "react-native";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedRemotePhotos, remotePhoto } from "@/db/__tests__/fixtures";
import { setMemoriesNotifPrefs } from "@/db/queries/memories";
import { installFakeScheduler, type FakeScheduler } from "@/test/fake-notifications";
import { refreshMemoriesReminders, registerMemoriesReminderTriggers, rescheduleMemoriesReminders } from "./reminders";

/** Local noon, so the bucket day is that day in every time zone. */
const noon = (year: number, month: number, day: number) => new Date(year, month, day, 12).getTime();

const NOW = new Date(2025, 5, 15, 8); // Jun 15 2025, 08:00

const permission = (granted: boolean): Notifications.NotificationPermissionsStatus => ({
  status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
  expires: "never",
  granted,
  canAskAgain: true,
});
const GRANTED = permission(true);
const DENIED = permission(false);

describe("memories reminders (#2746)", () => {
  let t: TestDb;
  let scheduler: FakeScheduler;
  beforeEach(() => {
    t = createTestDb();
    scheduler = installFakeScheduler();
    jest.mocked(Notifications.getPermissionsAsync).mockClear().mockResolvedValue(GRANTED);
    jest.mocked(Notifications.requestPermissionsAsync).mockClear();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "a", timestamp: noon(2020, 5, 16) }),
      remotePhoto({ id: "b", imageHash: "b", timestamp: noon(2022, 5, 16) }),
      remotePhoto({ id: "c", imageHash: "c", timestamp: noon(2021, 5, 20) }),
    ]);
  });
  afterEach(() => t.close());

  it("schedules only the days with memories, at the chosen time, with the year count", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true, hour: 20, minute: 15 });

    await expect(rescheduleMemoriesReminders(t.db, { now: NOW })).resolves.toBe(true);

    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-20"]);
    expect(scheduler.get("memories-2025-06-16")).toEqual({
      identifier: "memories-2025-06-16",
      content: {
        title: "On this day",
        body: "Photos from 2 earlier years on this day. Tap to look back.",
        data: { url: "/memories" },
      },
      trigger: { type: "date", date: new Date(2025, 5, 16, 20, 15) },
    });
    expect(scheduler.get("memories-2025-06-20")?.content.body).toBe(
      "Photos from 1 earlier year on this day. Tap to look back."
    );
  });

  it("moves every reminder when the time changes, without duplicates", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true, hour: 9, minute: 0 });
    await rescheduleMemoriesReminders(t.db, { now: NOW });
    setMemoriesNotifPrefs(t.db, { hour: 18, minute: 30 });
    await rescheduleMemoriesReminders(t.db, { now: NOW });

    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-20"]);
    const trigger = scheduler.get("memories-2025-06-20")?.trigger;
    expect(trigger).toEqual({ type: "date", date: new Date(2025, 5, 20, 18, 30) });
  });

  it("cancels every reminder when the setting is turned off", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true });
    await rescheduleMemoriesReminders(t.db, { now: NOW });
    scheduler.add("memories-daily");
    setMemoriesNotifPrefs(t.db, { enabled: false });

    await expect(rescheduleMemoriesReminders(t.db, { now: NOW })).resolves.toBe(true);

    expect(scheduler.ids()).toEqual([]);
  });

  it("schedules nothing without the permission, and asks only when told to", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(DENIED);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(DENIED);

    await expect(rescheduleMemoriesReminders(t.db, { now: NOW })).resolves.toBe(false);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await expect(rescheduleMemoriesReminders(t.db, { now: NOW, requestPermission: true })).resolves.toBe(false);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    expect(scheduler.ids()).toEqual([]);
  });

  it("runs overlapping plans one after the other", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true });
    await Promise.all([
      rescheduleMemoriesReminders(t.db, { now: NOW }),
      rescheduleMemoriesReminders(t.db, { now: NOW }),
    ]);
    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-20"]);
  });

  it("a refresh that fails is dropped, and the next one still runs", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true });
    jest.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error("no module"));
    await expect(refreshMemoriesReminders(t.db)).resolves.toBeUndefined();
    await expect(rescheduleMemoriesReminders(t.db, { now: NOW })).resolves.toBe(true);
  });

  it("plans on registration and whenever the app comes to the foreground", async () => {
    setMemoriesNotifPrefs(t.db, { enabled: true });
    const remove = jest.fn();
    const listen = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove });

    const unsubscribe = registerMemoriesReminderTriggers(t.db);
    const onChange = listen.mock.calls[0]?.[1];
    onChange?.("background");
    onChange?.("active");
    await rescheduleMemoriesReminders(t.db); // waits for the queued plans

    // Once on registration, once for "active", once just now.
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(remove).toHaveBeenCalled();
    listen.mockRestore();
  });
});
