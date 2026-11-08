import { hideNotification, showNotification, updateNotification } from "@mantine/notifications";
import { IconAlertCircle, IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { createElement } from "react";
import type { ReactNode } from "react";
import classes from "../../theme/notificationsTheme.module.css";
import { ToastWithUndo } from "./ToastWithUndo";

/** The optional parts of a toast. A second toast with the same `id` is ignored while the first one is up. */
export type ToastOptions = {
  title?: string;
  id?: string;
  /** Milliseconds, or false to keep the toast until it is closed. The app default is 3 s. */
  autoClose?: number | false;
};

type ToastKind = "success" | "warning" | "error";

/**
 * The only place a toast gets its colour and icon: teal and a check for done, orange and a
 * triangle for a heads-up, red and a circle for a failure (the tinted circle and the shades are in
 * theme/notificationsTheme.module.css). Everything else in the app goes through `notification`
 * (service/notifications), never @mantine/notifications directly; the lint config bans that import.
 */
const LOOKS: Record<ToastKind, { color: string; icon: Icon; className: string | undefined }> = {
  success: { color: "teal", icon: IconCheck, className: classes.success },
  warning: { color: "orange", icon: IconAlertTriangle, className: classes.warning },
  error: { color: "red", icon: IconAlertCircle, className: classes.error },
};

/** The colour, icon and accent class of a toast of this kind. */
function lookOf(kind: ToastKind) {
  const { color, icon, className } = LOOKS[kind];
  return { color, className, icon: createElement(icon, { size: 18, stroke: 2, "aria-hidden": true }) };
}

function show(kind: ToastKind, message: ReactNode, { title, id, autoClose }: ToastOptions = {}): void {
  showNotification({ ...lookOf(kind), message, title, id, autoClose });
}

/**
 * What a counted toast on screen shows, by id: the total, a second total some toasts add up beside
 * it, and how to undo what it reports.
 */
type CountedToast = { total: number; extra: number; undos: ReadonlyArray<() => Promise<unknown>> };

/** The counted toasts on screen, by id. */
const countedToasts = new Map<string, CountedToast>();

/** How long a toast with an Undo button stays: long enough to notice the slip and reach it. */
const UNDO_TOAST_MS = 8000;

/** The options of a counted toast. */
type CountedToastOptions = Omit<ToastOptions, "id"> & {
  /**
   * Puts back what this toast reports (#127). With one, the toast gets an Undo button and stays
   * 8 s. A repeat adds its own undo, and Undo runs them all, the latest first.
   */
  undo?: () => Promise<unknown>;
  /** A second number the toast adds up and passes to its message, e.g. the twins labelled along (#2754). */
  extra?: number;
};

/**
 * A success toast that adds up: while one with this id is on screen, a repeat raises the number it
 * shows instead of stacking another toast, so confirming faces one by one says "3 faces" once.
 */
function successCounted(
  id: string,
  count: number,
  message: (total: number, extra: number) => ReactNode,
  { title, autoClose, undo, extra = 0 }: CountedToastOptions = {}
): void {
  const shown = countedToasts.get(id);
  const undos = [...(shown?.undos ?? []), ...(undo ? [undo] : [])];
  const total = (shown?.total ?? 0) + count;
  const extraTotal = (shown?.extra ?? 0) + extra;
  countedToasts.set(id, { total, extra: extraTotal, undos });
  const text = message(total, extraTotal);
  const body = undos.length > 0 ? createElement(ToastWithUndo, { message: text, onUndo: () => undoCounted(id) }) : text;
  const closesAfter = undos.length > 0 ? (autoClose ?? UNDO_TOAST_MS) : autoClose;
  if (shown === undefined) {
    const onClose = () => countedToasts.delete(id);
    showNotification({ ...lookOf("success"), id, title, autoClose: closesAfter, message: body, onClose });
  } else {
    updateNotification({ ...lookOf("success"), id, title, autoClose: closesAfter, message: body });
  }
}

/** The Undo of a counted toast: closes it, then undoes what it reported, the latest first. */
function undoCounted(id: string): void {
  const undos = countedToasts.get(id)?.undos ?? [];
  countedToasts.delete(id);
  hideNotification(id);
  void undoInTurn([...undos].reverse());
}

async function undoInTurn(undos: ReadonlyArray<() => Promise<unknown>>): Promise<void> {
  try {
    // One after the other: two undos of the same face must land in order
    for (const undo of undos) await undo();
  } catch {
    // The QueryClient reports the failed request; the undos after it are not sent
  }
}

export const toast = {
  success: (message: ReactNode, options?: ToastOptions) => show("success", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => show("warning", message, options),
  error: (message: ReactNode, options?: ToastOptions) => show("error", message, options),
  successCounted,
  hide: (id: string) => {
    hideNotification(id);
  },
};
