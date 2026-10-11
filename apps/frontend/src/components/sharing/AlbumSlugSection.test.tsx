/**
 * The link settings start from the server's copy of the album and follow it when it changes,
 * but never over a setting the owner is editing: the dirty flags guard the sync and do not
 * trigger it. Saving clears them; that must not put the old server values back before the
 * refetch lands.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSharingOptions } from "../../api_client/albums/hooks";
import { UserAlbum } from "../../api_client/albums/types";
import { AlbumSlugSection } from "./AlbumSlugSection";

type SaveCallbacks = { onSuccess?: () => void };

const stubs = vi.hoisted(() => {
  class ApiError extends Error {
    status = 404;
  }
  return {
    ApiError,
    mutate: vi.fn<(params: unknown, callbacks: SaveCallbacks) => void>(),
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../util/util", () => ({ copyToClipboard: () => {} }));
vi.mock("../../api_client/albums/hooks", () => ({
  useToggleUserAlbumPublicMutation: () => ({ mutate: stubs.mutate }),
}));
// The slug availability check: a 404 means the slug is free
vi.mock("../../api_client/api", () => ({
  ApiError: stubs.ApiError,
  fetchClient: { get: () => Promise.reject(new stubs.ApiError()) },
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

const albumWith = (options: PublicSharingOptions) =>
  UserAlbum.parse({
    id: "867",
    title: "Trip",
    owner: { id: 1, username: "owner", first_name: "", last_name: "" },
    date: "",
    location: "",
    grouped_photos: [],
    public_slug: "trip",
    public_sharing_options: options,
  });

let root: Root;
let container: HTMLDivElement;
const queryClient = new QueryClient();

async function render(album: UserAlbum) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <AlbumSlugSection albumID="867" album={album} isPublic showSettings refetch={() => {}} />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

const checkbox = (label: string) => {
  const input = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(element =>
    element.closest(".mantine-Checkbox-root")?.textContent?.includes(label)
  );
  if (!input) throw new Error(`no ${label} checkbox`);
  return input;
};

beforeEach(() => {
  stubs.mutate.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AlbumSlugSection", () => {
  it("follows the server's sharing options until the owner edits them", async () => {
    await render(albumWith({ share_location: true }));
    expect(checkbox("sharing.shareLocation").checked).toBe(true);

    await render(albumWith({ share_location: false }));
    expect(checkbox("sharing.shareLocation").checked).toBe(false);

    act(() => checkbox("sharing.shareFaces").click());
    expect(checkbox("sharing.shareFaces").checked).toBe(true);

    // A refetch while the owner is editing does not overwrite the edit
    await render(albumWith({ share_location: true, share_faces: false }));
    expect(checkbox("sharing.shareFaces").checked).toBe(true);
    expect(checkbox("sharing.shareLocation").checked).toBe(false);
  });

  it("keeps the saved options when saving clears the edit flags", async () => {
    stubs.mutate.mockImplementation((_params, callbacks) => callbacks.onSuccess?.());
    await render(albumWith({ share_faces: false }));

    act(() => checkbox("sharing.shareFaces").click());
    const save = [...container.querySelectorAll("button")].find(b => b.textContent === "sharing.saveLinkSettings");
    if (!save) throw new Error("no save button");
    act(() => save.click());

    expect(stubs.mutate).toHaveBeenCalledTimes(1);
    // The refetch has not landed yet: the server copy still says false
    expect(checkbox("sharing.shareFaces").checked).toBe(true);
  });
});
