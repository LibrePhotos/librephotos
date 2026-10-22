/**
 * #2037: `g` then a letter goes to a page from anywhere in the app, a hint lists the letters after
 * `g`, and `?` opens the list of shortcuts.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<(options: { to: string }) => Promise<void>>(),
  isAdmin: false,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { is_superuser: stubs.isAdmin } }),
}));

let root: Root;
let container: HTMLDivElement;

const render = async () => {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <KeyboardShortcuts>
          <button type="button" id="page-button">
            page
          </button>
          <input id="page-input" />
        </KeyboardShortcuts>
      </MantineProvider>
    );
  });
};

const press = async (key: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};
const hint = () => document.querySelector('[role="status"]');
const dialog = () => document.querySelector('[role="dialog"]');

beforeAll(async () => {
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

beforeEach(() => {
  stubs.navigate.mockReset();
  stubs.navigate.mockResolvedValue(undefined);
  stubs.isAdmin = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("KeyboardShortcuts", () => {
  it("goes to Settings on g then s, and stops the second key there", async () => {
    await render();
    await press("g");
    expect(hint()?.textContent).toContain(i18n.t("topmenu.settings"));

    const second = await press("s");

    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/settings" });
    expect(second.defaultPrevented).toBe(true);
    expect(hint()).toBeNull();
  });

  it("does nothing on a second key alone", async () => {
    await render();
    await press("s");
    expect(stubs.navigate).not.toHaveBeenCalled();
  });

  it("forgets the g after a while", async () => {
    vi.useFakeTimers();
    await render();
    await press("g");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(hint()).toBeNull();
    await press("s");
    expect(stubs.navigate).not.toHaveBeenCalled();
  });

  it("ignores keys typed into a field", async () => {
    await render();
    const input = container.querySelector("#page-input");
    if (!input) throw new Error("no input");
    await press("g", input);
    await press("s", input);

    expect(stubs.navigate).not.toHaveBeenCalled();
    expect(hint()).toBeNull();
  });

  it("gives admins the Admin Area chord, and only them", async () => {
    await render();
    await press("g");
    expect(hint()?.textContent).not.toContain(i18n.t("topmenu.adminarea"));
    await press("a");
    expect(stubs.navigate).not.toHaveBeenCalled();

    stubs.isAdmin = true;
    await render();
    await press("g");
    expect(hint()?.textContent).toContain(i18n.t("topmenu.adminarea"));
    await press("a");
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/admin" });
  });

  it("opens the list of shortcuts on ?, and then leaves keys to the dialog", async () => {
    await render();
    await press("?");

    expect(dialog()?.textContent).toContain(i18n.t("shortcuts.title"));
    expect(dialog()?.textContent).toContain(i18n.t("topmenu.jobs"));
    await press("g");
    await press("s");
    expect(stubs.navigate).not.toHaveBeenCalled();
  });
});
