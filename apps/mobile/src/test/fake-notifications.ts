import * as Notifications from "expo-notifications";

/** The local notifications scheduled on the fake device, by identifier. */
export type FakeScheduler = {
  /** Scheduled identifiers, sorted. */
  ids: () => string[];
  /** The request scheduled under `id`. */
  get: (id: string) => Notifications.NotificationRequestInput | undefined;
  /** Something else (or an older app version) scheduled `id`. */
  add: (id: string) => void;
};

/** A request as the device lists it once scheduled. */
function asScheduled(identifier: string, request: Notifications.NotificationRequestInput): Notifications.NotificationRequest {
  return {
    identifier,
    content: {
      title: request.content.title ?? null,
      subtitle: request.content.subtitle ?? null,
      body: request.content.body ?? null,
      data: request.content.data,
      categoryIdentifier: null,
      sound: null,
    },
    trigger: request.trigger ?? { type: "unknown" },
  };
}

/**
 * Back the jest.setup.js expo-notifications stub with an in-memory schedule:
 * scheduling an identifier again replaces it, as on a device, and
 * getAllScheduledNotificationsAsync lists what is there. Call in beforeEach.
 */
export function installFakeScheduler(): FakeScheduler {
  const scheduled = new Map<string, Notifications.NotificationRequestInput>();
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request) => {
    const id = request.identifier ?? `generated-${scheduled.size}`;
    scheduled.set(id, request);
    return id;
  });
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (id) => {
    scheduled.delete(id);
  });
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () =>
    [...scheduled.entries()].map(([identifier, request]) => asScheduled(identifier, request))
  );
  return {
    ids: () => [...scheduled.keys()].sort(),
    get: (id) => scheduled.get(id),
    add: (id) => {
      scheduled.set(id, { identifier: id, content: {}, trigger: null });
    },
  };
}
