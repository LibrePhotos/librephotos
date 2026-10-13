/**
 * My Albums told a user whose server was down (proxy answering 502) "No albums
 * yet": the page only checked `isLoading` and an empty list, so a failed request
 * read like lost albums, with no way to try again short of a reload (#2221).
 * The leading "-" keeps the router plugin from taking this for a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { defined } from "../../../util/defined.test-utils";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  refetch: vi.fn<() => Promise<unknown>>(),
  albums: { data: undefined as unknown[] | undefined, isLoading: false, isFetching: false, isError: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
  useNavigate: () => () => {},
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchUserAlbumsQuery: () => ({ ...stubs.albums, refetch: stubs.refetch }),
  useToggleUserAlbumLockedMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../../components/album/UserAlbumModals", () => ({
  DeleteUserAlbumModal: () => null,
  RenameUserAlbumModal: () => null,
}));
vi.mock("../../../components/sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../../../components/virtual/TileGrid", () => ({
  TileGrid: ({ items }: { items: unknown[] }) => <div data-testid="grid">{items.length}</div>,
}));

let root: Root | undefined;
let container: HTMLDivElement;

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
  await import("./user.index");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  stubs.refetch.mockReset();
});

async function renderPage() {
  const AlbumUser = defined(stubs.component);
  container = document.createElement("div");
  document.body.appendChild(container);
  const pageRoot = createRoot(container);
  root = pageRoot;
  await act(async () => {
    pageRoot.render(
      <MantineProvider>
        <AlbumUser />
      </MantineProvider>
    );
  });
}

function retryButton() {
  return [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("errorstate.retry"));
}

describe("My Albums", () => {
  it("shows an error with Retry, not the empty state, when the list failed", async () => {
    stubs.albums = { data: undefined, isLoading: false, isFetching: false, isError: true };
    await renderPage();

    expect(container.textContent).not.toContain(i18n.t("emptystate.useralbums.title"));
    expect(container.textContent).toContain(i18n.t("errorstate.title"));
    await act(async () => defined(retryButton()).click());
    expect(stubs.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the albums on screen when only a background refetch failed", async () => {
    stubs.albums = { data: [{ id: 1 }], isLoading: false, isFetching: false, isError: true };
    await renderPage();

    expect(container.querySelector("[data-testid=grid]")?.textContent).toBe("1");
    expect(retryButton()).toBeUndefined();
  });

  it("still says there are none when the list is really empty", async () => {
    stubs.albums = { data: [], isLoading: false, isFetching: false, isError: false };
    await renderPage();

    expect(container.textContent).toContain(i18n.t("emptystate.useralbums.title"));
    expect(retryButton()).toBeUndefined();
  });
});
