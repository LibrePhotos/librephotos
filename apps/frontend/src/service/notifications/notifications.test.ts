/**
 * Toasts are built from translation strings with placeholders. A call that
 * passes other names than the string uses shows the raw placeholder: every
 * album rename said "{{albumTitle}} was successfully renamed to {{newAlbumTitle}}".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from ".";
import i18n from "../../i18n";

const { showNotification } = vi.hoisted(() => ({ showNotification: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ showNotification }));

type Shown = { title?: string; message?: string };
const lastShown = () => showNotification.mock.calls.at(-1)?.[0] as Shown;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  showNotification.mockReset();
});

describe("notifications", () => {
  it.each(Object.keys(notification))("%s fills in every placeholder", name => {
    const show = notification[name as keyof typeof notification] as (...args: unknown[]) => void;

    // An array stands in for both a name and a list of names (taggedPhotos).
    show(["A"], 2, true);

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
