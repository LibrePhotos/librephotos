import type { UserAlbumInfo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { UserAlbumCard } from "./UserAlbumCard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock("../Tile", () => ({ Tile: () => <div /> }));

const album = (locked: boolean): UserAlbumInfo => ({
  id: 867,
  title: "Trip",
  cover_photo: null,
  photo_count: 3,
  owner: { id: 1, username: "owner", first_name: "", last_name: "" },
  shared_to: [],
  created_on: "2026-10-01T00:00:00Z",
  favorited: false,
  locked,
  public: false,
});

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

async function renderCard(locked: boolean, onToggleLocked = vi.fn<(id: string, locked: boolean) => void>()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <UserAlbumCard album={album(locked)} showActions onToggleLocked={onToggleLocked} />
      </MantineProvider>
    );
  });
  return {
    container,
    onToggleLocked,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function openActions(container: HTMLElement) {
  await act(async () => {
    defined(container.querySelector<HTMLButtonElement>('button[aria-label="Album actions"]')).click();
    await Promise.resolve();
  });
}

describe("UserAlbumCard album locking", () => {
  it("offers to lock an unlocked album and requests the locked state", async () => {
    const view = await renderCard(false);
    await openActions(view.container);

    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(element =>
      element.textContent?.includes("Lock album")
    );
    expect(item).toBeDefined();
    await act(async () => defined(item).click());
    expect(view.onToggleLocked).toHaveBeenCalledWith("867", true);
    expect(view.container.querySelector('[aria-label="This album is locked"]')).toBeNull();

    await view.cleanup();
  });

  it("shows a lock indicator and offers to unlock a locked album", async () => {
    const view = await renderCard(true);
    expect(view.container.querySelector('[aria-label="This album is locked"]')).not.toBeNull();

    await openActions(view.container);
    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(element =>
      element.textContent?.includes("Unlock album")
    );
    expect(item).toBeDefined();
    await act(async () => defined(item).click());
    expect(view.onToggleLocked).toHaveBeenCalledWith("867", false);

    await view.cleanup();
  });
});

// #2245: the cover link, the shared-with button and the public and locked icons had no name.
describe("UserAlbumCard accessible names", () => {
  it("names the cover link, the shared-with button and the status icons", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const shared: UserAlbumInfo = {
      ...album(true),
      public: true,
      shared_to: [{ id: 2, username: "friend", first_name: "", last_name: "" }],
    };
    await act(async () => {
      root.render(
        <MantineProvider>
          <UserAlbumCard album={shared} />
        </MantineProvider>
      );
    });

    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Trip");
    const sharedWith = defined(container.querySelector<HTMLElement>('[role="button"]'));
    expect(sharedWith.getAttribute("aria-label")).toBe("Shared with:");
    expect(sharedWith.tabIndex).toBe(0);
    const icons = Array.from(container.querySelectorAll('[role="img"]'), icon => icon.getAttribute("aria-label"));
    expect(icons).toEqual(["This album is locked", "This album is public"]);

    await act(async () => root.unmount());
    container.remove();
  });
});

describe("UserAlbumCard actions", () => {
  it("offers rename, sharing and delete, and opens the shared-with list from the keyboard", async () => {
    const onRename = vi.fn<(id: string, title: string) => void>();
    const onShare = vi.fn<(id: string, title: string) => void>();
    const onDelete = vi.fn<(id: string, title: string) => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const withCover: UserAlbumInfo = {
      ...album(false),
      cover_photo: { image_hash: "cover", video: false },
      shared_to: [{ id: 2, username: "friend", first_name: "", last_name: "" }],
    };
    await act(async () => {
      root.render(
        // env="test": no transitions, so the shared-with list shows at once
        <MantineProvider env="test">
          <UserAlbumCard album={withCover} showActions onRename={onRename} onShare={onShare} onDelete={onDelete} />
        </MantineProvider>
      );
    });

    for (const [label, handler] of [
      ["Rename", onRename],
      ["Sharing", onShare],
      ["Delete", onDelete],
    ] as const) {
      await openActions(container);
      const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        element => element.textContent === label
      );
      await act(async () => defined(item, label).click());
      expect(handler).toHaveBeenCalledWith("867", "Trip");
    }

    const sharedWith = defined(container.querySelector<HTMLElement>('[role="button"]'));
    await act(async () => {
      sharedWith.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("friend");

    await act(async () => root.unmount());
    container.remove();
  });
});
