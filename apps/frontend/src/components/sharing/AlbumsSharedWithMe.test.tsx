/**
 * The shared-album grids sized their columns from the window (less a sidebar that was never
 * passed in) once on mount, through a resize observer whose ref was never attached. The grid
 * came out wider than the page, cutting off its last column, and never followed a resize.
 * They now size the columns from the width their own container gets.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { AlbumsSharedWithMe } from "./AlbumsSharedWithMe";

const stubs = vi.hoisted(() => ({ width: 1200 }));

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
        })),
      },
    ],
    isFetching: false,
    isSuccess: true,
  };
  return { useFetchSharedAlbumsWithMeQuery: () => result };
});
vi.mock("../../api_client/user/hooks", () => {
  const result = { data: [{ id: 2, username: "bob", first_name: "Bob", last_name: "B" }] };
  return { useFetchUserListQuery: () => result };
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
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
  await act(async () => {
    root!.render(
      <MantineProvider>
        <AlbumsSharedWithMe />
      </MantineProvider>
    );
  });
  const scroller = container.querySelector<HTMLElement>("div[tabindex='0']")!;
  const canvas = scroller.firstElementChild as HTMLElement;
  const titles = Array.from(container.querySelectorAll("a[href^='/album/user/']"), a => a.closest("div[style]")!);
  return {
    canvasWidth: parseFloat(canvas.style.width),
    columns: new Set(titles.map(cell => (cell as HTMLElement).style.left)).size,
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
});
