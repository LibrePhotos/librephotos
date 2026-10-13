/**
 * The shared-album grids sized their columns from the window (less a sidebar that was never
 * passed in) once on mount, through a resize observer whose ref was never attached. The grid
 * came out wider than the page, cutting off its last column, and never followed a resize.
 * They now size the columns from the width their own container gets.
 *
 * Each tile has a "⋮" chip with Leave album (#2210), which asks before it leaves.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useLeaveSharedAlbumMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { AlbumsSharedWithMe } from "./AlbumsSharedWithMe";

type Leave = ReturnType<typeof useLeaveSharedAlbumMutation>["mutate"];

const stubs = vi.hoisted(() => ({ width: 1200, leave: vi.fn<Leave>() }));

// The covers are router links now (a plain href reloaded the whole app).
vi.mock("@tanstack/react-router", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    Link: forwardRef<HTMLAnchorElement, { to: string; params: { id: string }; children?: React.ReactNode }>(
      ({ to, params, ...rest }, ref) => createElement("a", { ref, href: to.replace("$id", params.id), ...rest })
    ),
  };
});
vi.mock("@mantine/hooks", async importOriginal => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useElementSize: () => ({ ref: () => {}, width: stubs.width, height: 0 }),
}));
// Stable references, as react-query hands them out: the component recomputes its cells per new list
vi.mock("../../api_client/albums/hooks", () => {
  const result = {
    data: [
      {
        user_id: 2,
        albums: Array.from({ length: 12 }, (_unused, i) => ({
          id: i + 1,
          title: `Trip ${i + 1}`,
          photo_count: 2,
          cover_photo: null,
          owner: { id: 2, username: "bob", first_name: "Bob", last_name: "B" },
        })),
      },
    ],
    isFetching: false,
    isSuccess: true,
  };
  return {
    useFetchSharedAlbumsWithMeQuery: () => result,
    useLeaveSharedAlbumMutation: () => ({ mutate: stubs.leave, isPending: false }),
  };
});
vi.mock("../../api_client/user/hooks", () => {
  const result = { data: [{ id: 2, username: "bob", first_name: "Bob", last_name: "B" }] };
  return { useFetchUserListQuery: () => result };
});

let root: ReturnType<typeof createRoot> | undefined;
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
});

beforeEach(() => {
  stubs.leave.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
});

async function renderAt(width: number) {
  stubs.width = width;
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  const mounted = root;
  await act(async () => {
    mounted.render(
      <MantineProvider>
        <AlbumsSharedWithMe />
      </MantineProvider>
    );
  });
  const canvas = container.querySelector("div[tabindex='0']")?.firstElementChild;
  if (!(canvas instanceof HTMLElement)) {
    throw new Error("the grid rendered no scroll canvas");
  }
  // Each cover link sits in a cell positioned by its inline left offset.
  const cells = Array.from(container.querySelectorAll("a[href^='/album/user/']"), a => {
    const cell = a.closest("div[style]");
    if (!(cell instanceof HTMLElement)) {
      throw new Error("a cover link is not in a positioned cell");
    }
    return cell;
  });
  return {
    canvasWidth: parseFloat(canvas.style.width),
    columns: new Set(cells.map(cell => cell.style.left)).size,
  };
}

describe("the albums-shared-with-me grid", () => {
  it("fits its columns into the container and follows a resize", async () => {
    const wide = await renderAt(1200);
    expect(wide.canvasWidth).toBeLessThanOrEqual(1200);
    expect(wide.columns).toBeGreaterThan(3);

    const narrow = await renderAt(700);
    expect(narrow.canvasWidth).toBeLessThanOrEqual(700);
    expect(narrow.columns).toBeLessThan(wide.columns);
  });

  it("keeps a long title on one line, with the full title on hover", async () => {
    await renderAt(1200);

    const title = Array.from(container.querySelectorAll<HTMLElement>("[data-line-clamp]")).find(
      element => element.textContent === "Trip 1"
    );
    expect(title?.getAttribute("title")).toBe("Trip 1");
    expect(container.querySelector("a[href='/album/user/1']")).not.toBeNull();
  });

  it("leaves an album from its chip, after asking", async () => {
    await renderAt(1200);

    const chip = defined(container.querySelector<HTMLButtonElement>('button[aria-label="Album actions: Trip 3"]'));
    await act(async () => chip.click());
    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      el => el.textContent?.trim() === "Leave album"
    );
    await act(async () => defined(item, "the Leave album item").click());

    const dialog = defined(document.body.querySelector('[role="dialog"]'), "the confirmation");
    expect(dialog.textContent).toContain("Leave Trip 3?");
    expect(dialog.textContent).toContain("Bob B can share it with you again.");
    expect(stubs.leave).not.toHaveBeenCalled();

    const confirm = Array.from(dialog.querySelectorAll("button")).find(el => el.textContent?.trim() === "Leave album");
    await act(async () => defined(confirm, "the confirm button").click());
    expect(stubs.leave).toHaveBeenCalledWith({ id: "3", title: "Trip 3" }, expect.anything());
  });
});
