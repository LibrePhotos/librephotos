/**
 * The link settings start from the server's copy of the album and follow it when it changes,
 * but never over a setting the owner is editing: the dirty flags guard the sync and do not
 * trigger it. Saving clears them; that must not put the old server values back before the
 * refetch lands.
 */
import { UserAlbum } from "@librephotos/api-client";
import type { PublicSharingOptions } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumSlugSection } from "./AlbumSlugSection";

type SaveCallbacks = { onSuccess?: () => void; onError?: (error: unknown) => void };

const stubs = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status = 404) {
      super(`HTTP ${status}`);
    }
  }
  return {
    ApiError,
    mutate: vi.fn<(params: unknown, callbacks: SaveCallbacks) => void>(),
    // The album that holds a slug, undefined for a free one (the server's 404), or "pending" for
    // a check that has not answered yet
    slugOwner: undefined as string | undefined,
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../util/util", () => ({ copyToClipboard: () => {} }));
vi.mock("../../api_client/albums/hooks", async () => ({
  useToggleUserAlbumPublicMutation: () => ({ mutate: stubs.mutate }),
  // The real check, on the client stubbed below.
  useSlugAvailabilityQuery: (await import("../../api_client/albums/hooks/useSlugAvailabilityQuery"))
    .useSlugAvailabilityQuery,
}));
// The slug availability check: a 404 means the slug is free
vi.mock("../../api_client/api", () => ({
  ApiError: stubs.ApiError,
  apiClient: {
    get: () => {
      if (stubs.slugOwner === "pending") return new Promise(() => {});
      return stubs.slugOwner === undefined
        ? Promise.reject(new stubs.ApiError())
        : Promise.resolve({ results: { id: stubs.slugOwner } });
    },
  },
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

const albumWith = (options: PublicSharingOptions, fields: Record<string, unknown> = {}) =>
  UserAlbum.parse({
    id: "867",
    title: "Trip",
    owner: { id: 1, username: "owner", first_name: "", last_name: "" },
    date: "",
    location: "",
    grouped_photos: [],
    public_slug: "trip",
    public_sharing_options: options,
    ...fields,
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
  stubs.slugOwner = undefined;
  queryClient.clear();
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

describe("AlbumSlugSection link settings", () => {
  const slugInput = () => {
    const label = [...container.querySelectorAll("label")].find(element => element.textContent === "sharing.customUrl");
    const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!(input instanceof HTMLInputElement)) throw new Error("no custom URL input");
    return input;
  };
  const saveButton = () => {
    const save = [...container.querySelectorAll("button")].find(b => b.textContent === "sharing.saveLinkSettings");
    if (!save) throw new Error("no save button");
    return save;
  };
  // React tracks the previous value on the node itself, so a plain assignment is swallowed.
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  async function typeSlug(value: string) {
    await act(async () => {
      setInputValue?.call(slugInput(), value);
      slugInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Let the availability check settle
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  const sent = () => stubs.mutate.mock.calls[0]?.[0];

  it("offers no save until something changed", async () => {
    await render(albumWith({}));

    expect(slugInput().value).toBe("trip");
    expect(saveButton().disabled).toBe(true);
  });

  it("lower-cases the slug and saves only what changed", async () => {
    await render(albumWith({}));
    await typeSlug("Summer-2026");

    expect(slugInput().value).toBe("summer-2026");
    expect(saveButton().disabled).toBe(false);
    act(() => saveButton().click());

    expect(sent()).toEqual({
      albumId: "867",
      public: true,
      slug: "summer-2026",
      expires_at: undefined,
      sharing_options: undefined,
    });
  });

  it.each(["ab", "with space", "under_score", "x".repeat(65)])("refuses the slug %j", async slug => {
    await render(albumWith({}));
    await typeSlug(slug);

    expect(container.textContent).toContain("sharing.customUrlError");
    expect(saveButton().disabled).toBe(true);
  });

  it("refuses a slug another album holds, but not the album's own", async () => {
    stubs.slugOwner = "12";
    await render(albumWith({}));
    await typeSlug("taken");

    expect(container.textContent).toContain("sharing.urlTaken");
    expect(saveButton().disabled).toBe(true);

    stubs.slugOwner = "867";
    await typeSlug("mine");
    expect(container.textContent).not.toContain("sharing.urlTaken");
    expect(saveButton().disabled).toBe(false);
  });

  // The check of a new slug has no answer yet: that is not "taken", only not saveable yet.
  it("does not call a slug taken while its check is running", async () => {
    stubs.slugOwner = "pending";
    await render(albumWith({}));
    await typeSlug("summer");

    expect(container.textContent).not.toContain("sharing.urlTaken");
    expect(saveButton().disabled).toBe(true);
  });

  it("clears the expiry with Never", async () => {
    await render(albumWith({}, { public_expires_at: "2030-01-01T00:00:00Z" }));
    const never = [...container.querySelectorAll("button")].find(b => b.textContent === "sharing.never");
    if (!never) throw new Error("no Never button");
    act(() => never.click());
    act(() => saveButton().click());

    expect(sent()).toEqual({
      albumId: "867",
      public: true,
      slug: undefined,
      expires_at: null,
      sharing_options: undefined,
    });
  });

  it.each([
    [409, "sharing.urlTaken"],
    [400, "sharing.customUrlError"],
    [500, "sharing.saveLinkError"],
  ])("explains a refused save (HTTP %i)", async (status, message) => {
    stubs.mutate.mockImplementation((_params, callbacks) => callbacks.onError?.(new stubs.ApiError(status)));
    await render(albumWith({}));
    await typeSlug("summer");
    expect(container.textContent).not.toContain(message);

    act(() => saveButton().click());

    expect(container.textContent).toContain(message);
  });
});
