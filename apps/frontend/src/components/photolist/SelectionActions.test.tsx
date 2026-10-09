/**
 * The selection menu's "Mark as photo / screenshot / document" (issue #2130):
 * by hashes for a plain selection, by the server-side query for select-all,
 * with the excluded tiles left out (placeholders that never loaded have no
 * hash and must not turn the request into a 400).
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SelectionActions } from "./SelectionActions";

const stubs = vi.hoisted(() => ({ setCategory: vi.fn() }));
const noopMutation = vi.hoisted(() => () => ({ mutate: () => {}, mutateAsync: async () => {} }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({ useRemovePhotoFromUserAlbumMutation: noopMutation }));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: noopMutation }));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: noopMutation,
  useSetFavoritePhotosMutation: noopMutation,
  useSetPhotosHiddenMutation: noopMutation,
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

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.setCategory.mockReset();
});

async function markAs(props: Partial<React.ComponentProps<typeof SelectionActions>>, label: string) {
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
    (menuButtons[menuButtons.length - 1] as HTMLButtonElement).click();
  });
  const item = Array.from(document.body.querySelectorAll("button")).find(
    button => button.textContent?.trim() === label
  );
  if (!item) throw new Error(`no menu item ${label}`);
  await act(async () => {
    item.click();
  });
}

describe("SelectionActions Mark as", () => {
  it("sends the selected hashes", async () => {
    await markAs(
      {
        selectedItems: [
          { id: "1", image_hash: "aaa" },
          { id: "2", image_hash: "bbb", isTemp: true },
        ] as any,
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
        selectedItems: [{ id: "1", image_hash: "aaa" }, { id: "temp-2" }] as any,
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
