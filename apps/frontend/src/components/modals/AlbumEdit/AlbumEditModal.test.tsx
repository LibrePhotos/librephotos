import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { AlbumEditModal } from "./AlbumEditModal";

const hooks = vi.hoisted(() => ({
  add: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../../../api_client/albums/hooks", () => ({
  useAddPhotoToUserAlbumMutation: () => ({ mutate: hooks.add }),
  useCreateUserAlbumMutation: () => ({ mutate: hooks.create }),
  useFetchUserAlbumsQuery: () => ({
    data: [
      {
        id: 867,
        title: "Finished trip",
        cover_photo: null,
        photo_count: 3,
        owner: { id: 1, username: "owner", first_name: "", last_name: "" },
        shared_to: [],
        created_on: "2026-10-01T00:00:00Z",
        favorited: false,
        locked: true,
      },
    ],
  }),
}));

vi.mock("../../Tile", () => ({ Tile: () => <div /> }));

beforeAll(async () => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

describe("AlbumEditModal locked albums", () => {
  beforeEach(() => hooks.add.mockClear());

  it("shows the locked state and prevents adding photos", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MantineProvider>
          <AlbumEditModal
            isOpen
            onRequestClose={() => {}}
            selectedImages={[{ id: "photo-id", image_hash: "photo-hash" }]}
          />
        </MantineProvider>
      );
    });

    const lockedAlbum = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Finished trip is locked. Unlock it to add photos."]'
    );
    expect(lockedAlbum).not.toBeNull();
    expect(lockedAlbum!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Locked");

    await act(async () => lockedAlbum!.click());
    expect(hooks.add).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });
});
