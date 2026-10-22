/**
 * Sharing a whole library (#2731), the recipient's side: the libraries shared with me on the
 * Sharing overview (hidden while there are none), my "Show in my timeline" switch, the badge on
 * the timeline, the library page's parts and leaving a library after a confirmation.
 */
import type { LibraryShare } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  useDeleteLibraryShareMutation,
  useUpdateLibraryShareMutation,
} from "../../api_client/libraryShares/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { LibrariesSharedWithYouSection } from "./LibrariesSharedWithYouSection";
import { LibraryMenu, LibraryNotShared, LibrarySubHeader, ReadOnlyBadge } from "./SharedLibraryParts";
import { TimelineLibrariesNote } from "./TimelineLibrariesNote";

type Update = ReturnType<typeof useUpdateLibraryShareMutation>["mutate"];
type Remove = ReturnType<typeof useDeleteLibraryShareMutation>["mutate"];

const ANNA = { id: 1, username: "anna", first_name: "Anna", last_name: "Berger" };
const ME = { id: 2, username: "ben", first_name: "Ben", last_name: "Okafor" };

function received(overrides: Partial<LibraryShare> = {}): LibraryShare {
  return {
    id: 9,
    owner: ANNA,
    recipient: ME,
    show_in_timeline: false,
    share_location: false,
    share_faces: false,
    share_camera_info: false,
    share_captions: true,
    share_originals: false,
    created_at: "2026-10-03T10:00:00Z",
    photo_count: 8912,
    ...overrides,
  };
}

const stubs = vi.hoisted(() => ({
  shares: [] as LibraryShare[],
  update: vi.fn<Update>(),
  remove: vi.fn<Remove>(),
  navigate: vi.fn<(options: { to: string }) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("../../api_client/libraryShares/hooks", () => ({
  useLibrarySharesQuery: () => ({ data: stubs.shares, isLoading: false }),
  useUpdateLibraryShareMutation: () => ({ mutate: stubs.update, isPending: false }),
  useDeleteLibraryShareMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 2 } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => stubs.navigate,
  useLocation: () => ({ pathname: "/" }),
}));

let root: ReturnType<typeof createRoot> | undefined;

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  stubs.shares = [];
  stubs.update.mockReset();
  stubs.remove.mockReset();
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(<MantineProvider env="test">{node}</MantineProvider>));
  return container;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Libraries shared with you", () => {
  it("is not there until someone shares a library with me", async () => {
    stubs.shares = [received({ owner: ME, recipient: ANNA })];
    const container = await render(<LibrariesSharedWithYouSection />);
    expect(container.textContent).not.toContain("Libraries shared with you");
  });

  it("links each library and turns it on in my timeline", async () => {
    stubs.shares = [received()];
    const container = await render(<LibrariesSharedWithYouSection />);
    expect(container.textContent).toContain("Anna Berger's library");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/sharing/library/$userId");
    await click(defined(container.querySelector('input[type="checkbox"]')));
    expect(stubs.update).toHaveBeenCalledWith({ shareId: 9, patch: { show_in_timeline: true } });
  });

  it("names the libraries the timeline shows", async () => {
    stubs.shares = [received({ show_in_timeline: true })];
    const container = await render(<TimelineLibrariesNote />);
    expect(container.textContent).toContain("Including Anna");
    stubs.shares = [received()];
    const empty = await render(<TimelineLibrariesNote />);
    expect(empty.textContent).not.toContain("Including");
  });
});

describe("the library page's parts", () => {
  it("says what the owner shares, read-only", async () => {
    const container = await render(
      <>
        <ReadOnlyBadge />
        <LibrarySubHeader share={received()} />
      </>
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Read-only");
    expect(text).toContain("Show in my timeline");
    expect(text).toContain("No location");
    expect(text).toContain("Captions");
  });

  it("says when a library is not shared with me", async () => {
    const container = await render(<LibraryNotShared />);
    expect(container.textContent).toContain("This library is not shared with you");
  });

  it("leaves a library after asking", async () => {
    await render(<LibraryMenu share={received()} />);
    await click(defined(document.querySelector('button[aria-label="Leave Anna\'s library"]')));
    await click(defined(Array.from(document.querySelectorAll('[role="menuitem"]'))[0]));
    expect(document.body.textContent).toContain("Leave Anna's library?");
    const leave = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === "Leave");
    await click(defined(leave));
    expect(stubs.remove.mock.calls[0]?.[0]).toEqual({ shareId: 9, side: "recipient", name: "Anna Berger" });
  });
});
