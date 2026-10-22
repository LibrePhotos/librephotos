import * as Notifications from "expo-notifications";
import {
  cancelMemoriesReminder,
  MEMORIES_DEEP_LINK,
  memoriesNotificationId,
  planMemoriesReminders,
  scheduleMemoriesReminders,
  type MemoriesReminder,
} from "./notifications";
import { installFakeScheduler, type FakeScheduler } from "@/test/fake-notifications";

const day = (month: number, date: number, photoCount = 1, yearCount = 1) => ({
  day: new Date(2025, month, date),
  photoCount,
  yearCount,
});

describe("memoriesNotificationId", () => {
  it("names the local day, zero-padded", () => {
    expect(memoriesNotificationId(new Date(2025, 0, 5, 23, 59))).toBe("memories-2025-01-05");
    expect(memoriesNotificationId(new Date(2025, 11, 31))).toBe("memories-2025-12-31");
  });
});

describe("planMemoriesReminders", () => {
  const time = { hour: 9, minute: 30 };

  it("plans one reminder at the chosen time on each day with memories", () => {
    const plan = planMemoriesReminders(
      [day(5, 15, 0, 0), day(5, 16, 3, 2), day(5, 17, 0, 0), day(5, 18, 1, 1)],
      time,
      new Date(2025, 5, 15, 8)
    );
    expect(plan).toEqual([
      { id: "memories-2025-06-16", date: new Date(2025, 5, 16, 9, 30), photoCount: 3, yearCount: 2 },
      { id: "memories-2025-06-18", date: new Date(2025, 5, 18, 9, 30), photoCount: 1, yearCount: 1 },
    ]);
  });

  it("keeps today's reminder until its time has passed", () => {
    const days = [day(5, 15), day(5, 16)];
    expect(planMemoriesReminders(days, time, new Date(2025, 5, 15, 9, 29)).map((r) => r.id)).toEqual([
      "memories-2025-06-15",
      "memories-2025-06-16",
    ]);
    expect(planMemoriesReminders(days, time, new Date(2025, 5, 15, 9, 30)).map((r) => r.id)).toEqual([
      "memories-2025-06-16",
    ]);
  });
});

describe("scheduling", () => {
  let scheduler: FakeScheduler;
  beforeEach(() => {
    scheduler = installFakeScheduler();
  });

  const reminders: MemoriesReminder[] = [
    { id: "memories-2025-06-16", date: new Date(2025, 5, 16, 9), photoCount: 3, yearCount: 2 },
    { id: "memories-2025-06-18", date: new Date(2025, 5, 18, 9), photoCount: 1, yearCount: 1 },
  ];
  const content = (r: MemoriesReminder) => ({ title: "On this day", body: `${r.yearCount} years` });

  it("schedules each reminder for its date, with its count and the memories link", async () => {
    await scheduleMemoriesReminders(reminders, content);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "memories-2025-06-16",
      content: { title: "On this day", body: "2 years", data: { url: MEMORIES_DEEP_LINK } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(2025, 5, 16, 9) },
    });
    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-18"]);
  });

  it("replaces what was scheduled: the old daily reminder and days no longer planned go", async () => {
    scheduler.add("memories-daily");
    scheduler.add("memories-2025-06-17");
    scheduler.add("someone-else");

    await scheduleMemoriesReminders(reminders, content);

    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-18", "someone-else"]);
  });

  it("does not duplicate a reminder when scheduled twice", async () => {
    await scheduleMemoriesReminders(reminders, content);
    await scheduleMemoriesReminders(reminders, content);
    expect(scheduler.ids()).toEqual(["memories-2025-06-16", "memories-2025-06-18"]);
  });

  it("cancels every memories reminder and nothing else", async () => {
    await scheduleMemoriesReminders(reminders, content);
    scheduler.add("someone-else");

    await cancelMemoriesReminder();

    expect(scheduler.ids()).toEqual(["someone-else"]);
  });

  it("cancelling without the native module is not an error", async () => {
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockRejectedValueOnce(new Error("no module"));
    await expect(cancelMemoriesReminder()).resolves.toBeUndefined();
  });
});
