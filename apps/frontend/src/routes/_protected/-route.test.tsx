/**
 * A full load of a signed-in page painted a lone spinner in the top-left corner of an empty page
 * before the header and menu appeared (#2238): the protected layout waited for a "query" that only
 * reads a cookie. The first render must be the app shell for a signed-in user, and the redirect to
 * /login for anyone else.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthCookies, setAuthCookie } from "../../api_client/authCookies";
// Registers the layout component through the createFileRoute stub below.
import "./route";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  navigateProps: vi.fn<(props: Record<string, unknown>) => void>(),
  // What each render of the layout put on screen, in order.
  painted: [] as string[],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component?: React.ComponentType }) => {
    stubs.component = options.component;
    return {};
  },
  Navigate: (props: Record<string, unknown>) => {
    stubs.navigateProps(props);
    stubs.painted.push("redirect");
    return null;
  },
  Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("../../components/common/PageLoader", () => ({
  PageLoader: () => {
    stubs.painted.push("loader");
    return <div data-testid="page-loader" />;
  },
}));
vi.mock("../../components/menubars/TopMenu", () => ({
  TopMenu: () => {
    stubs.painted.push("shell");
    return <div data-testid="top-menu" />;
  },
}));
vi.mock("../../components/menubars/SideMenuNarrow", () => ({ SideMenuNarrow: () => null }));
vi.mock("../../components/menubars/FooterMenu", () => ({ FooterMenu: () => null }));
vi.mock("../../components/spotlight", () => ({ SpotlightProvider: () => null }));
vi.mock("../../components/shortcuts/KeyboardShortcuts", () => ({
  KeyboardShortcuts: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../components/upload", () => ({
  UploadProvider: ({ children }: { children: React.ReactNode }) => children,
  UploadDropTarget: ({ children }: { children: React.ReactNode }) => children,
  UploadProgressCard: () => null,
}));
vi.mock("../../components/whatsnew/WhatsNewProvider", () => ({
  WhatsNewProvider: ({ children }: { children: React.ReactNode }) => children,
}));

let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(() => {
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
});

beforeEach(() => {
  stubs.painted = [];
  stubs.navigateProps.mockReset();
  clearAuthCookies();
  window.history.replaceState(null, "", "/photos?tab=all");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  clearAuthCookies();
});

async function renderLayout() {
  const Layout = stubs.component;
  if (!Layout) {
    throw new Error("the route module did not register its component");
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <MantineProvider>
        <QueryClientProvider client={queryClient}>
          <Layout />
        </QueryClientProvider>
      </MantineProvider>
    );
  });
}

describe("protected layout", () => {
  it("paints the app shell first for a signed-in user, never a loader", async () => {
    setAuthCookie("access", "token");
    await renderLayout();

    expect(stubs.painted[0]).toBe("shell");
    expect(stubs.painted).not.toContain("loader");
    expect(container.querySelector("[data-testid=outlet]")).not.toBeNull();
    expect(stubs.navigateProps).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to /login with the page to return to", async () => {
    await renderLayout();

    expect(stubs.painted[0]).toBe("redirect");
    expect(stubs.painted).not.toContain("loader");
    expect(stubs.navigateProps).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/login", search: { redirect: "/photos?tab=all" }, replace: true })
    );
  });
});
