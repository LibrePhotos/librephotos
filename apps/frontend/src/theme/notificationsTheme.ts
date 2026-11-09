import { Notification } from "@mantine/core";
import classes from "./notificationsTheme.module.css";

/**
 * Theme defaults for toasts (App.tsx): 16px corners and the look in notificationsTheme.module.css.
 * The icon and the status colour of each toast are set where toasts are shown
 * (service/notifications/toast.ts).
 */
export const notificationsTheme = {
  Notification: Notification.extend({
    defaultProps: { radius: "lg" },
    classNames: { root: classes.root, icon: classes.icon, body: classes.body, title: classes.title },
  }),
};
