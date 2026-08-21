import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

/**
 * Routes a tapped local notification to its deep-link target (the memories
 * reminder carries `data.url`). Mounted once inside the authed navigator.
 * Renders nothing.
 */
export function NotificationRouter() {
  const router = useRouter();

  useEffect(() => {
    const go = (url: unknown) => {
      if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
    };
    // Cold start: app opened from a notification tap.
    void Notifications.getLastNotificationResponseAsync().then((res) => {
      go(res?.notification.request.content.data?.url);
    });
    // Warm taps while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      go(res.notification.request.content.data?.url);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
