/**
 * Toasts are built from translation strings with placeholders. A call that
 * passes other names than the string uses shows the raw placeholder: every
 * album rename said "{{albumTitle}} was successfully renamed to {{newAlbumTitle}}".
 */
import { MantineProvider } from "@mantine/core";
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from ".";
import i18n from "../../i18n";
import { toast } from "./toast";

type Shown = {
  title?: string;
  message?: ReactNode;
  color?: string;
  id?: string;
  autoClose?: number | false;
  onClose?: () => void;
};

const { showNotification, hideNotification, updateNotification } = vi.hoisted(() => ({
  showNotification: vi.fn<(notification: Shown) => void>(),
  hideNotification: vi.fn<(id: string) => void>(),
  updateNotification: vi.fn<(notification: Shown) => void>(),
}));
vi.mock("@mantine/notifications", () => ({ showNotification, hideNotification, updateNotification }));

const lastShown = (): Shown => {
  const shown = showNotification.mock.calls.at(-1)?.[0];
  if (!shown) throw new Error("no notification was shown");
  return shown;
};

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

/** What a toast's message says; one with an Undo button is a component (#127). */
const textOf = (message: ReactNode): string =>
  renderToStaticMarkup(createElement(MantineProvider, { env: "test" }, message));

beforeEach(() => {
  showNotification.mockReset();
  hideNotification.mockReset();
  updateNotification.mockReset();
});

// The mock never closes a toast: close each one, so a counted toast does not carry into the next test
afterEach(() => {
  showNotification.mock.calls.forEach(([shown]) => shown.onClose?.());
});

describe("notifications", () => {
  // The primitives take any message, so they are tested on their own below.
  const helpers = Object.entries(notification).filter(([name]) => !(name in toast));

  it.each(helpers)("%s fills in every placeholder", (_name, show) => {
    // An array stands in for both a name and a list of names (taggedPhotos). The arguments
    // fit no notifier's parameters on purpose, so the call is made through Reflect.apply.
    Reflect.apply(show, undefined, [["A"], 2, true]);

    const { title, message } = lastShown();
    expect(`${title ?? ""} ${textOf(message)}`).not.toContain("{{");
  });

  it("names the old and the new title of a renamed album", () => {
    notification.renameAlbum("Summer", "Summer 2026");

    expect(lastShown().message).toBe("Summer was successfully renamed to Summer 2026.");
  });

  it("says what went wrong with a refused login, not the field name", () => {
    notification.authError(true, "detail", "No active account found with the given credentials");

    expect(lastShown()).toMatchObject({ title: "Login failed", message: "Incorrect username or password." });
  });

  it("keeps the server's text for other authentication errors", () => {
    notification.authError(false, "detail", "Token is invalid or expired");

    expect(lastShown()).toMatchObject({ title: "Detail", message: "Token is invalid or expired" });
  });

  it("reports a server error in words, with the endpoint for the bug report", () => {
    notification.serverError("/photos/");

    expect(lastShown().title).toBe("Server error");
    expect(lastShown().message).toContain("/photos/");
    expect(lastShown().message).not.toContain("developer tools");
  });
});

describe("notification primitives", () => {
  it.each([
    ["success", "teal"],
    ["warning", "orange"],
    ["error", "red"],
  ] as const)("%s shows a %s toast", (kind, color) => {
    notification[kind]("Saved");

    expect(lastShown()).toMatchObject({ message: "Saved", color });
  });

  it("passes the title, id and autoClose through", () => {
    notification.success("Moved to Trash", { title: "Photos", id: "photo-undo", autoClose: 10000 });

    expect(lastShown()).toMatchObject({ title: "Photos", id: "photo-undo", autoClose: 10000 });
  });

  it("keeps a toast open when autoClose is false", () => {
    notification.error("Upload failed", { autoClose: false });

    expect(lastShown().autoClose).toBe(false);
  });

  it("leaves the title, id and autoClose out when they are not given", () => {
    notification.warning("Heads up");

    expect(lastShown()).toEqual({
      message: "Heads up",
      color: "orange",
      title: undefined,
      id: undefined,
      autoClose: undefined,
    });
  });

  it("hides the toast with the given id", () => {
    notification.hide("photo-undo");

    expect(hideNotification).toHaveBeenCalledWith("photo-undo");
    expect(showNotification).not.toHaveBeenCalled();
  });
});

describe("counted toasts (#599: faces confirmed one at a time)", () => {
  it("raise the number on the toast on screen instead of stacking another", () => {
    notification.addFacesToPerson("Anna", 1);
    notification.addFacesToPerson("Anna", 2);

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(updateNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "faces-labeled-Anna", message: "3 face(s) were labeled as the person Anna" })
    );
  });

  it("count each person on their own toast", () => {
    notification.addFacesToPerson("Ben", 1);
    notification.addFacesToPerson("Cleo", 1);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(updateNotification).not.toHaveBeenCalled();
  });

  it("start again from the new count once the toast has closed", () => {
    notification.deleteFaces(2);
    lastShown().onClose?.();
    notification.deleteFaces(1);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(lastShown()).toMatchObject({ id: "faces-deleted", message: "1 face(s) were deleted", color: "teal" });
  });
});

describe("date rules applied (#437)", () => {
  it("says how many photos moved and how many keep the date set by hand", () => {
    notification.dateRulesApplied(312, 41, 0);

    expect(lastShown()).toMatchObject({
      title: "Date rules applied",
      message: "312 photos moved to another day. 41 photos keep the date you set by hand.",
      color: "teal",
    });
  });

  it("leaves out the hand-set count when there is none", () => {
    notification.dateRulesApplied(1, 0, 0);

    expect(lastShown().message).toBe("1 photo moved to another day.");
  });

  it("stays open as a warning when some dates could not be read", () => {
    notification.dateRulesApplied(0, 0, 2);

    expect(lastShown()).toMatchObject({
      message: "0 photos moved to another day. The dates of 2 photos could not be read; the job list has the details.",
      color: "orange",
      autoClose: false,
    });
  });
});

describe("toasts with an Undo (#127)", () => {
  /** Shows the message as the toast would, and clicks its Undo button. */
  async function clickUndo(message: ReactNode) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(MantineProvider, { env: "test" }, message)));
    const undo = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Undo");
    if (!undo) throw new Error("the toast has no Undo button");
    await act(async () => undo.click());
    await act(async () => root.unmount());
    container.remove();
  }

  it("get an Undo button and stay 8 s", () => {
    notification.deleteFaces(2, () => Promise.resolve());

    expect(lastShown().autoClose).toBe(8000);
    expect(textOf(lastShown().message)).toContain("2 face(s) were deleted");
    expect(textOf(lastShown().message)).toContain("Undo");
  });

  it("close and undo every action the toast adds up, the latest first", async () => {
    const undone: string[] = [];
    notification.removeFacesFromPerson(1, async () => {
      undone.push("first");
    });
    notification.removeFacesFromPerson(1, async () => {
      undone.push("second");
    });
    const latest = updateNotification.mock.calls.at(-1)?.[0];

    await clickUndo(latest?.message);

    expect(hideNotification).toHaveBeenCalledWith("faces-unlabeled");
    expect(undone).toEqual(["second", "first"]);
  });

  it("stop at an undo that fails: the QueryClient reports it", async () => {
    const later = vi.fn<() => Promise<void>>(() => Promise.resolve());
    notification.deleteFaces(1, later);
    notification.deleteFaces(1, () => Promise.reject(new Error("offline")));

    await clickUndo(updateNotification.mock.calls.at(-1)?.[0].message);

    expect(later).not.toHaveBeenCalled();
  });

  it("start counting afresh after an Undo", async () => {
    notification.deleteFaces(3, () => Promise.resolve());
    await clickUndo(lastShown().message);
    notification.deleteFaces(1);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(lastShown()).toMatchObject({ message: "1 face(s) were deleted", autoClose: undefined });
  });
});

describe("moving photos (#352)", () => {
  const counts = { moved: 3, skipped: 0, refused: 0, failed: 0 };

  it("names the folder the photos went to", () => {
    notification.photosMoved(counts, "Porto");
    expect(lastShown()).toMatchObject({ color: "teal", message: "Moved 3 photos to Porto." });
  });

  it("says how many stayed, and keeps that toast up", () => {
    notification.photosMoved({ ...counts, skipped: 1, failed: 1 }, "Porto");
    expect(lastShown()).toMatchObject({
      color: "orange",
      message: "Moved 3 photos to Porto. 2 photos stayed where they were.",
      autoClose: false,
    });
    notification.photosMoved({ ...counts, moved: 0, refused: 1 }, "Porto");
    expect(lastShown().message).toBe("Nothing moved: 1 photo stayed where it was.");
  });

  it("shows the server's reason for a refused move, else a plain one", () => {
    notification.photosMoveFailed("The folder is not in your library.");
    expect(lastShown()).toMatchObject({ color: "red", message: "The folder is not in your library." });
    notification.photosMoveFailed(null);
    expect(lastShown().message).toBe("The photos could not be moved.");
    notification.movePhotosStarted();
    expect(lastShown().message).toBe("The photos are moving in the background.");
  });
});
