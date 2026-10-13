/**
 * Leaving a page while its "Save changes?" prompt is showing (#2224).
 *
 * Settings, Profile and Library keep edits on the page until Save. Following a sidebar link or
 * closing the tab dropped them without a word. Now a link asks "Leave without saving?" first and
 * the tab asks through the browser's own dialog. Picking a section on the same page (a hash
 * change) still goes through.
 */
import { MantineProvider } from "@mantine/core";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SaveChangesDialog } from "./SaveChangesDialog";

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  await i18n.changeLanguage("en");
});

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** The settings page with its prompt `opened` (edits pending or not), and a photos page to go to. */
async function renderSettingsPage(opened: boolean) {
  window.history.replaceState(null, "", "/settings");
  const rootRoute = createRootRoute({ component: Outlet });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <SaveChangesDialog opened={opened} onSave={() => {}} onCancel={() => {}} />,
  });
  const photosRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/photos",
    component: () => <p>photos page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute, photosRoute]),
    history: createBrowserHistory(),
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  /** Follows a link the way the sidebar does; resolves once the router has settled. */
  const follow = async (href: string) => {
    await act(async () => {
      router.history.push(href);
      await vi.waitFor(() => expect(router.state.status).toBe("idle"));
    });
  };
  return { router, follow };
}

const leaveDialog = () => document.body.querySelector('[role="dialog"][aria-modal="true"]');

function buttonNamed(label: string) {
  const button = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`button "${label}" not found`);
  return button;
}

describe("leaving a page with unsaved edits", () => {
  it("asks before following a link, and Stay keeps the page and its edits", async () => {
    const { router, follow } = await renderSettingsPage(true);

    await follow("/photos");
    await vi.waitFor(() => expect(leaveDialog()?.textContent).toContain("Leave without saving?"));
    expect(router.state.location.pathname).toBe("/settings");

    await act(async () => buttonNamed("Stay on page").click());
    await vi.waitFor(() => expect(leaveDialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("leaves when the user confirms", async () => {
    const { router, follow } = await renderSettingsPage(true);

    await follow("/photos");
    await vi.waitFor(() => expect(leaveDialog()).not.toBeNull());
    await act(async () => buttonNamed("Leave without saving").click());

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/photos"));
  });

  it("does not ask when nothing is pending", async () => {
    const { router, follow } = await renderSettingsPage(false);

    await follow("/photos");

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/photos"));
    expect(leaveDialog()).toBeNull();
  });

  it("lets a section pick on the same page through", async () => {
    const { router, follow } = await renderSettingsPage(true);

    await follow("/settings#faces");

    await vi.waitFor(() => expect(router.state.location.hash).toBe("faces"));
    expect(leaveDialog()).toBeNull();
  });

  it("asks the browser before closing the tab only while edits are pending", async () => {
    const closeTab = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    await renderSettingsPage(true);
    expect(closeTab()).toBe(true);
    await cleanup?.();
    cleanup = undefined;

    await renderSettingsPage(false);
    expect(closeTab()).toBe(false);
  });
});
