/**
 * The server refuses a blank album title with a 400, and the dialog closes
 * before the request settles, so Create must not be clickable without a name
 * (it only checked for duplicates and failed silently). The parent keeps the
 * modal mounted, so a typed title must not survive into the next opening.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumEditModal } from "./AlbumEditModal";

const stubs = vi.hoisted(() => ({ create: vi.fn(), add: vi.fn(), close: vi.fn() }));

vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchUserAlbumsQuery: () => ({
    data: [
      { id: 1, title: "Trip", photo_count: 3, created_on: "2026-01-01" },
      { id: 2, title: "Home", photo_count: 1, created_on: "2026-01-02" },
    ],
  }),
  useCreateUserAlbumMutation: () => ({ mutate: stubs.create }),
  useAddPhotoToUserAlbumMutation: () => ({ mutate: stubs.add }),
}));
vi.mock("../../album/AlbumListItem", () => ({
  AlbumListItem: ({ album }: { album: { title: string } }) => <span className="album">{album.title}</span>,
}));
vi.mock("../../Tile", () => ({ Tile: () => null }));

beforeAll(() => {
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
});

let root: Root;

function renderModal(isOpen: boolean) {
  act(() => {
    root.render(
      <MantineProvider>
        <AlbumEditModal
          isOpen={isOpen}
          onRequestClose={stubs.close}
          selectedImages={[{ id: "a1", image_hash: "a1" }]}
        />
      </MantineProvider>
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderModal(true);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const titleInput = () => document.querySelector(".mantine-Modal-body input") as HTMLInputElement;
const createButton = () => document.querySelector('.mantine-Modal-body button[type="submit"]') as HTMLButtonElement;
const listedAlbums = () => Array.from(document.querySelectorAll(".mantine-Modal-body .album"), el => el.textContent);

function type(value: string) {
  const input = titleInput();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AlbumEditModal", () => {
  it("keeps Create disabled until there is a new, non-blank title", () => {
    expect(createButton().disabled).toBe(true);
    type("   ");
    expect(createButton().disabled).toBe(true);
    type(" trip ");
    expect(createButton().disabled).toBe(true);
    type(" New ");
    expect(createButton().disabled).toBe(false);
  });

  it("sends the trimmed title", () => {
    type(" New ");
    act(() => createButton().click());

    expect(stubs.create).toHaveBeenCalledWith(expect.objectContaining({ title: "New", photos: ["a1"] }));
  });

  it("forgets the typed filter after adding to an existing album", () => {
    type("Tr");
    expect(listedAlbums()).toEqual(["Trip"]);
    act(() => (document.querySelector(".mantine-Modal-body .album")!.closest("button") as HTMLButtonElement).click());
    expect(stubs.add).toHaveBeenCalledWith(expect.objectContaining({ id: "1", photos: ["a1"] }));
    expect(stubs.close).toHaveBeenCalled();

    renderModal(false);
    renderModal(true);

    expect(titleInput().value).toBe("");
    expect(createButton().disabled).toBe(true);
    expect(listedAlbums()).toEqual(["Trip", "Home"]);
  });
});
