/**
 * The Folders page drew its "no folders" message inside the virtual grid, which
 * renders no cells at all for an empty list: the page was blank under its
 * header. The leading "-" keeps the router plugin from taking this for a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  folders: { subfolders: [] as unknown[], isLoading: false, isFetching: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
  useNavigate: () => () => {},
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useAllFolderSubfolders: () => stubs.folders,
}));

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
  await act(async () => root?.unmount());
  container?.remove();
});

async function renderPage() {
  await import("./folder.index");
  const AlbumFolder = stubs.component!;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MantineProvider>
        <AlbumFolder />
      </MantineProvider>
    );
  });
}

describe("the Folders page", () => {
  it("explains an empty folder list", async () => {
    stubs.folders = { subfolders: [], isLoading: false, isFetching: false };
    await renderPage();

    expect(container.textContent).toContain("0 folders with photos");
    expect(container.querySelector("h3")?.textContent).toBe("No folders with photos");
  });

  it("says 1 Photo, not 1 Photos, under a folder of one", async () => {
    stubs.folders = {
      subfolders: [
        { name: "single", path: "/photos/single", photo_count: 1 },
        { name: "trip", path: "/photos/trip", photo_count: 3 },
      ],
      isLoading: false,
      isFetching: false,
    };
    await renderPage();

    expect(container.textContent).toContain("1 Photo");
    expect(container.textContent).not.toContain("1 Photos");
    expect(container.textContent).toContain("3 Photos");
  });

  it("does not claim there are none while the first answer is out", async () => {
    stubs.folders = { subfolders: [], isLoading: true, isFetching: true };
    await renderPage();

    expect(container.querySelector("h3")).toBeNull();
  });
});
