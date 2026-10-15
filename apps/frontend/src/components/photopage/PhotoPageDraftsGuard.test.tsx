/**
 * The photo page's cards hold drafts like the lightbox's panel (#2284). Leaving the page while one
 * is unsaved (Back, a similar photo's link) asks "Leave without saving?", the settings pages'
 * question; a reload asks through the browser. Without an unsaved edit nothing is asked.
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
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { useRegisterDraft } from "../lightbox/unsavedDrafts";
import { PhotoPageDraftsGuard } from "./PhotoPageDraftsGuard";

/** A card's editor, reporting its draft as the caption, date, tags and location ones do. */
function CaptionCard() {
  const [draft, setDraft] = useState("");
  useRegisterDraft("caption", draft !== "");
  return (
    <div>
      <output data-testid="draft">{draft}</output>
      <button type="button" onClick={() => setDraft("A long caption")}>
        Type a caption
      </button>
    </div>
  );
}

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

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`button "${label}" not found`);
  return button;
}

const leaveDialog = () =>
  [...document.body.querySelectorAll('[role="dialog"]')].find(dialog =>
    dialog.textContent?.includes("Leave without saving?")
  ) ?? null;

/** The timeline, then photo `a`'s page, so Back has somewhere to go. */
async function renderPhotoPage() {
  window.history.replaceState(null, "", "/photos");
  const rootRoute = createRootRoute({ component: Outlet });
  const photosRoute = createRoute({ getParentRoute: () => rootRoute, path: "/photos", component: () => null });
  const photoRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/photo/$id",
    component: () => (
      <PhotoPageDraftsGuard>
        <CaptionCard />
      </PhotoPageDraftsGuard>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([photosRoute, photoRoute]),
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
    document.body.innerHTML = "";
  };
  await act(async () => router.load());
  await act(async () => router.history.push("/photo/a"));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/photo/a"));
  return router;
}

describe("photo page with an unsaved edit", () => {
  it("asks before a link leaves, and Stay keeps the page and the draft", async () => {
    const router = await renderPhotoPage();
    await act(async () => buttonNamed("Type a caption").click());

    await act(async () => router.history.push("/photo/b"));

    await vi.waitFor(() => expect(leaveDialog()).not.toBeNull());
    expect(router.state.location.pathname).toBe("/photo/a");
    await act(async () => buttonNamed("Stay on page").click());
    await vi.waitFor(() => expect(leaveDialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/photo/a");
    expect(document.body.querySelector('[data-testid="draft"]')?.textContent).toBe("A long caption");
  });

  it("goes Back after Leave without saving", async () => {
    const router = await renderPhotoPage();
    await act(async () => buttonNamed("Type a caption").click());

    await act(async () => router.history.back());
    await vi.waitFor(() => expect(leaveDialog()).not.toBeNull());
    await act(async () => buttonNamed("Leave without saving").click());

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/photos"));
  });

  it("asks the browser before a reload", async () => {
    await renderPhotoPage();
    const reload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(reload()).toBe(false);

    await act(async () => buttonNamed("Type a caption").click());
    expect(reload()).toBe(true);
  });
});

describe("photo page without an unsaved edit", () => {
  it("leaves without asking", async () => {
    const router = await renderPhotoPage();

    await act(async () => router.history.push("/photo/b"));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/photo/b"));
    expect(leaveDialog()).toBeNull();
  });
});
