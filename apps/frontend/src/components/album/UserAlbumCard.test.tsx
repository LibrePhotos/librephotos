import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { UserAlbumInfo } from "../../api_client/albums/types";
import i18n from "../../i18n";
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

async function renderCard(locked: boolean, onToggleLocked = vi.fn()) {
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
    container.querySelector<HTMLButtonElement>('button[aria-label="Album actions"]')!.click();
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
    await act(async () => item!.click());
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
    await act(async () => item!.click());
    expect(view.onToggleLocked).toHaveBeenCalledWith("867", false);

    await view.cleanup();
  });
});
