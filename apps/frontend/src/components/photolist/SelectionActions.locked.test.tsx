import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { useRemovePhotoFromUserAlbumMutation } from "../../api_client/albums/hooks";
import type { useMarkPhotosDeletedMutation } from "../../api_client/photos/hooks";
import { PigPhoto } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SelectionActions } from "./SelectionActions";

type Props = React.ComponentProps<typeof SelectionActions>;
type RemoveFromAlbum = ReturnType<typeof useRemovePhotoFromUserAlbumMutation>["mutate"];
type MarkDeleted = ReturnType<typeof useMarkPhotosDeletedMutation>["mutate"];

const hooks = vi.hoisted(() => ({ remove: vi.fn<RemoveFromAlbum>(), deleted: vi.fn<MarkDeleted>() }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/album/user/867" }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../../api_client/albums/hooks", () => ({
  useRemovePhotoFromUserAlbumMutation: () => ({ mutate: hooks.remove }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: () => ({ mutate: hooks.deleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosHiddenMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosPublicMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosCategoryMutation: () => ({ mutate: vi.fn<() => void>() }),
}));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: () => ({ mutate: vi.fn<() => void>() }) }));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: () => ({ mutate: vi.fn<() => void>() }),
  useMergeStacksMutation: () => ({ mutate: vi.fn<() => void>() }),
  useRemoveFromStackMutation: () => ({ mutateAsync: vi.fn<() => void>() }),
}));
vi.mock("../modals/ModalDownloadOptions", () => ({ ModalDownloadOptions: () => null }));
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
describe("locked album selection actions", () => {
  // A lock protects the album's photo set: only "Remove from album" is gated;
  // the photos themselves can still be favorited, hidden, shared or deleted.
  it.each([true, false])("gates only removal from the album when locked=%s", async locked => {
    hooks.remove.mockClear();
    hooks.deleted.mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <MantineProvider>
            <SelectionActions
              albumLocked={locked}
              albumID="867"
              title="Trip"
              selectedItems={[
                PigPhoto.parse({
                  id: "00000000-0000-4000-8000-000000000867",
                  image_hash: "photo-hash",
                  aspectRatio: 1,
                }),
              ]}
              updateSelectionState={vi.fn<Props["updateSelectionState"]>()}
              onSharePhotos={vi.fn<Props["onSharePhotos"]>()}
              onShareAlbum={vi.fn<Props["onShareAlbum"]>()}
              onAddToAlbum={vi.fn<Props["onAddToAlbum"]>()}
              onAddTags={vi.fn<Props["onAddTags"]>()}
              setAlbumCover={vi.fn<Props["setAlbumCover"]>()}
            />
          </MantineProvider>
        );
      });
      await act(async () => {
        container.querySelectorAll("button")[1].click();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
      });
      const menuItem = (key: string) =>
        Array.from(document.body.querySelectorAll('[role="menuitem"]'))
          .filter(item => item instanceof HTMLButtonElement)
          .find(item => item.textContent?.trim() === i18n.t(key));
      const remove = menuItem("selectionactions.removephotos");
      const deleted = menuItem("selectionactions.deleted");
      expect(remove).toBeDefined();
      expect(deleted).toBeDefined();
      expect(defined(remove).disabled).toBe(locked);
      expect(defined(deleted).disabled).toBe(false);
      for (const key of ["selectionactions.download", "selectionactions.favorite", "selectionactions.hide"]) {
        const item = menuItem(key);
        expect(item?.disabled).toBe(false);
      }
      await act(async () => defined(remove).click());
      expect(hooks.remove).toHaveBeenCalledTimes(locked ? 0 : 1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
