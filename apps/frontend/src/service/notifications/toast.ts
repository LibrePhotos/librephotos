import { hideNotification, showNotification } from "@mantine/notifications";
import type { ReactNode } from "react";

/** The optional parts of a toast. A second toast with the same `id` is ignored while the first one is up. */
export type ToastOptions = {
  title?: string;
  id?: string;
  /** Milliseconds, or false to keep the toast until it is closed. The app default is 3 s. */
  autoClose?: number | false;
};

/**
 * The only place a toast gets its colour: teal for done, orange for a heads-up, red for a failure.
 * Everything else in the app goes through `notification` (service/notifications), never
 * @mantine/notifications directly; the lint config bans that import.
 */
function show(color: string, message: ReactNode, { title, id, autoClose }: ToastOptions = {}): void {
  showNotification({ message, color, title, id, autoClose });
}

export const toast = {
  success: (message: ReactNode, options?: ToastOptions) => show("teal", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => show("orange", message, options),
  error: (message: ReactNode, options?: ToastOptions) => show("red", message, options),
  hide: (id: string) => {
    hideNotification(id);
  },
};
