import { useEffect } from "react";
import { useRouter } from "expo-router";
import { loadNotifications } from "@/lib/notificationsModule";
import { MEMORIES_DEEP_LINK } from "./notifications";

/**
 * Routes a tapped local notification to its deep-link target (the memories
 * reminder carries `data.url`). Mounted once inside the authed navigator.
 * Renders nothing.
 */
export function NotificationRouter() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    const go = (url: unknown) => {
      // The memories reminder is the only notification that carries a link.
      if (url === MEMORIES_DEEP_LINK) router.push(MEMORIES_DEEP_LINK);
    };
    void loadNotifications().then((Notifications) => {
      if (!Notifications || cancelled) return;
      // Cold start: app opened from a notification tap.
      void Notifications.getLastNotificationResponseAsync().then((res) => {
        go(res?.notification.request.content.data?.url);
      });
      // Warm taps while the app is running.
      const sub = Notifications.addNotificationResponseReceivedListener((res) => {
        go(res.notification.request.content.data?.url);
      });
      remove = () => sub.remove();
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);

  return null;
}
