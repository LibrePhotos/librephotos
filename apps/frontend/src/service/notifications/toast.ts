import { hideNotification, showNotification, updateNotification } from "@mantine/notifications";
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

/** The counted toasts on screen, by id, with the total each one shows. */
const countedToasts = new Map<string, number>();

/**
 * A success toast that adds up: while one with this id is on screen, a repeat raises the number it
 * shows instead of stacking another toast, so confirming faces one by one says "3 faces" once.
 */
function successCounted(
  id: string,
  count: number,
  message: (total: number) => ReactNode,
  { title, autoClose }: Omit<ToastOptions, "id"> = {}
): void {
  const shown = countedToasts.get(id);
  const total = (shown ?? 0) + count;
  countedToasts.set(id, total);
  if (shown === undefined) {
    const onClose = () => countedToasts.delete(id);
    showNotification({ id, color: "teal", title, autoClose, message: message(total), onClose });
  } else {
    updateNotification({ id, color: "teal", title, autoClose, message: message(total) });
  }
}

export const toast = {
  success: (message: ReactNode, options?: ToastOptions) => show("teal", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => show("orange", message, options),
  error: (message: ReactNode, options?: ToastOptions) => show("red", message, options),
  successCounted,
  hide: (id: string) => {
    hideNotification(id);
  },
};
