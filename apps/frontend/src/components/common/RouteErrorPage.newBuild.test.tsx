import { MantineProvider } from "@mantine/core";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { RouteErrorPage } from "./RouteFallbacks";

const stubs = vi.hoisted(() => ({
  capture: vi.fn<(error: unknown) => void>(),
  reload: vi.fn<() => void>(),
}));

vi.mock("../../service/errorReporting/sentryClient", () => ({ capture: stubs.capture }));

let root: Root;
let container: HTMLDivElement;

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
  sessionStorage.clear();
  vi.stubGlobal("location", { ...window.location, reload: stubs.reload });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a page whose code file a new build removed", () => {
  it("shows the error page and reloads once instead of reporting the error", async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const page = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: lazyRouteComponent(() =>
        Promise.reject(new Error("Unable to preload CSS for http://localhost/assets/page-old.css"))
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultErrorComponent: RouteErrorPage,
    });

    await act(async () => {
      root.render(
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      );
    });

    await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("routefallback.errortitle")));
    expect(stubs.reload).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(stubs.capture).not.toHaveBeenCalled();
  });
});
