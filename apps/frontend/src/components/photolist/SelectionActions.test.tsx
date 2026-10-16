/**
 * The selection menu's "Mark as photo / screenshot / document" (issue #2130):
 * by hashes for a plain selection, by the server-side query for select-all,
 * with the excluded tiles left out (placeholders that never loaded have no
 * hash and must not turn the request into a 400).
 *
 * Its rating actions follow the user's rating style (#2202): Favorite /
 * Unfavorite, or a "Set rating" submenu that rates by hash only.
 */
import { PigPhoto } from "@librephotos/api-client";
import type { User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  useSetFavoritePhotosMutation,
  useSetPhotosCategoryMutation,
  useSetPhotosRatingMutation,
} from "../../api_client/photos/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { addTempElementsToFlatList } from "../../util/util";
import { SelectionActions } from "./SelectionActions";

type SetCategory = ReturnType<typeof useSetPhotosCategoryMutation>["mutate"];
type SetFavorite = ReturnType<typeof useSetFavoritePhotosMutation>["mutate"];
type SetRating = ReturnType<typeof useSetPhotosRatingMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  setCategory: vi.fn<SetCategory>(),
  setFavorite: vi.fn<SetFavorite>(),
  setRating: vi.fn<SetRating>(),
  ratingMode: "favorite" as User["rating_mode"],
}));
const noopMutation = vi.hoisted(() => () => ({ mutate: () => {}, mutateAsync: async () => {} }));
// The Files items have their own tests (FileActionItems.test.tsx).
vi.mock("./FileActionItems", () => ({ FileActionItems: () => null, SelectionFileItems: () => null }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({ useRemovePhotoFromUserAlbumMutation: noopMutation }));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: noopMutation }));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: noopMutation,
  useSetFavoritePhotosMutation: () => ({ mutate: stubs.setFavorite }),
  useSetPhotosRatingMutation: () => ({ mutate: stubs.setRating }),
  useSetPhotosHiddenMutation: noopMutation,
  useSetPhotosArchivedMutation: noopMutation,
  useSetPhotosPublicMutation: noopMutation,
  useSetPhotosCategoryMutation: () => ({ mutate: stubs.setCategory }),
}));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: noopMutation,
  useMergeStacksMutation: noopMutation,
  useRemoveFromStackMutation: noopMutation,
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../modals/ModalDownloadOptions", () => ({ ModalDownloadOptions: () => null }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { favorite_min_rating: 4, rating_mode: stubs.ratingMode } }),
}));

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
  document.body.innerHTML = "";
  stubs.setCategory.mockReset();
  stubs.setFavorite.mockReset();
  stubs.setRating.mockReset();
  stubs.ratingMode = "favorite";
});

// A loaded grid photo; PigPhoto fills in the other fields' defaults.
function photo(n: number, imageHash: string, extra: Partial<PigPhoto> = {}) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return PigPhoto.parse({ id, image_hash: imageHash, aspectRatio: 1, ...extra });
}

// The grid's stand-in for a photo of a page not loaded yet: it has no hash.
const placeholder = defined(addTempElementsToFlatList(1)[0], "the placeholder");

async function openPhotoActions(props: Partial<React.ComponentProps<typeof SelectionActions>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <SelectionActions
          selectedItems={[]}
          updateSelectionState={() => {}}
          onSharePhotos={() => {}}
          setAlbumCover={() => {}}
          onShareAlbum={() => {}}
          onAddToAlbum={() => {}}
          onAddTags={() => {}}
          title="Photos"
          {...props}
        />
      </MantineProvider>
    );
  });
  // The second menu (the dots) holds the photo actions.
  const menuButtons = container.querySelectorAll("button");
  await act(async () => {
    defined(menuButtons[menuButtons.length - 1]).click();
  });
}

function menuItem(label: string) {
  const item = Array.from(document.body.querySelectorAll("button")).find(
    button => button.textContent?.trim() === label
  );
  if (!item) throw new Error(`no menu item ${label}`);
  return item;
}

async function markAs(props: Partial<React.ComponentProps<typeof SelectionActions>>, label: string) {
  await openPhotoActions(props);
  await act(async () => {
    menuItem(label).click();
  });
}

describe("SelectionActions Mark as", () => {
  it("sends the selected hashes", async () => {
    await markAs(
      {
        selectedItems: [photo(1, "aaa"), photo(2, "bbb", { isTemp: true })],
      },
      "Mark as document"
    );
    expect(stubs.setCategory).toHaveBeenCalledWith({ image_hashes: ["aaa"], category: "document" });
  });

  it("sends the select-all query and drops hashless exclusions", async () => {
    await markAs(
      {
        selectAllMode: true,
        selectAllQuery: { hide_screenshots: true },
        selectedItems: [photo(1, "aaa"), placeholder],
      },
      "Mark as photo"
    );
    expect(stubs.setCategory).toHaveBeenCalledWith({
      select_all: true,
      query: { hide_screenshots: true },
      excluded_hashes: ["aaa"],
      category: "photo",
    });
  });
});

describe("SelectionActions rating", () => {
  it("favorites the selection in favorite mode", async () => {
    await markAs({ selectedItems: [photo(1, "aaa")] }, "Unfavorite");
    expect(stubs.setFavorite).toHaveBeenCalledWith({ image_hashes: ["aaa"], favorite: false });
    expect(() => menuItem("Set rating")).toThrow();
  });

  it("rates the selection through the Set rating submenu in stars mode", async () => {
    stubs.ratingMode = "stars";
    await openPhotoActions({ selectedItems: [photo(1, "aaa"), photo(2, "bbb")] });

    expect(() => menuItem("Favorite")).toThrow();
    expect(() => menuItem("Unfavorite")).toThrow();
    await act(async () => {
      menuItem("Set rating").click();
    });
    await act(async () => {
      menuItem("4 stars").click();
    });

    expect(stubs.setRating).toHaveBeenCalledWith({ image_hashes: ["aaa", "bbb"], rating: 4 });
    expect(stubs.setFavorite).not.toHaveBeenCalled();
  });

  it("disables Set rating after Select all, which the server refuses to rate", async () => {
    stubs.ratingMode = "stars";
    await openPhotoActions({ selectAllMode: true, selectAllQuery: {}, selectedItems: [] });

    const item = menuItem("Set rating");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    await act(async () => item.click());
    expect(stubs.setRating).not.toHaveBeenCalled();
  });
});
