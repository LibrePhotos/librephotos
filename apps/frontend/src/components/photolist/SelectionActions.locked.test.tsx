import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PigPhoto } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { SelectionActions } from "./SelectionActions";

const hooks = vi.hoisted(() => ({ remove: vi.fn(), deleted: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/album/user/867" }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../../api_client/albums/hooks", () => ({
  useRemovePhotoFromUserAlbumMutation: () => ({ mutate: hooks.remove }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: () => ({ mutate: hooks.deleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: vi.fn() }),
  useSetPhotosHiddenMutation: () => ({ mutate: vi.fn() }),
  useSetPhotosPublicMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: () => ({ mutate: vi.fn() }) }));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: () => ({ mutate: vi.fn() }),
  useMergeStacksMutation: () => ({ mutate: vi.fn() }),
  useRemoveFromStackMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../modals/ModalDownloadOptions", () => ({ ModalDownloadOptions: () => null }));
beforeAll(async () => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});
describe("locked album selection actions", () => {
  it.each([true, false])("gates deletion and removal when locked=%s", async locked => {
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
              updateSelectionState={vi.fn()}
              onSharePhotos={vi.fn()}
              onShareAlbum={vi.fn()}
              onAddToAlbum={vi.fn()}
              onAddTags={vi.fn()}
              setAlbumCover={vi.fn()}
            />
          </MantineProvider>
        );
      });
      await act(async () => {
        container.querySelectorAll<HTMLButtonElement>("button")[1].click();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
      });
      const menuItem = (key: string) =>
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
          item => item.textContent?.trim() === i18n.t(key)
        );
      const remove = menuItem("selectionactions.removephotos");
      const deleted = menuItem("selectionactions.deleted");
      expect(remove).toBeDefined();
      expect(deleted).toBeDefined();
      expect(remove!.disabled).toBe(locked);
      expect(deleted!.disabled).toBe(locked);
      expect(menuItem("selectionactions.download")!.disabled).toBe(false);
      await act(async () => remove!.click());
      expect(hooks.remove).toHaveBeenCalledTimes(locked ? 0 : 1);
      if (locked) {
        await act(async () => deleted!.click());
        expect(hooks.deleted).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
