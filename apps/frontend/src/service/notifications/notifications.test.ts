/**
 * Toasts are built from translation strings with placeholders. A call that
 * passes other names than the string uses shows the raw placeholder: every
 * album rename said "{{albumTitle}} was successfully renamed to {{newAlbumTitle}}".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from ".";
import i18n from "../../i18n";
import { toast } from "./toast";

type Shown = {
  title?: string;
  message?: string;
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
  await i18n.changeLanguage("en");
});

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
    expect(`${title ?? ""} ${message ?? ""}`).not.toContain("{{");
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
