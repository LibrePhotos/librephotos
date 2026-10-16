import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import type { ParseKeys } from "i18next";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { useRemovePhotoFromUserAlbumMutation } from "../../api_client/albums/hooks";
import type { useMarkPhotosDeletedMutation } from "../../api_client/photos/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason, hoverAndReadTooltip } from "../common/disabledReason.test-utils";
import { SelectionActions } from "./SelectionActions";

type Props = React.ComponentProps<typeof SelectionActions>;
type RemoveFromAlbum = ReturnType<typeof useRemovePhotoFromUserAlbumMutation>["mutate"];
type MarkDeleted = ReturnType<typeof useMarkPhotosDeletedMutation>["mutate"];

const hooks = vi.hoisted(() => ({ remove: vi.fn<RemoveFromAlbum>(), deleted: vi.fn<MarkDeleted>() }));
// The Files items have their own tests (FileActionItems.test.tsx).
vi.mock("./FileActionItems", () => ({ FileActionItems: () => null, SelectionFileItems: () => null }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/album/user/867" }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../../api_client/albums/hooks", () => ({
  useRemovePhotoFromUserAlbumMutation: () => ({ mutate: hooks.remove }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: () => ({ mutate: hooks.deleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosRatingMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosHiddenMutation: () => ({ mutate: vi.fn<() => void>() }),
  useSetPhotosArchivedMutation: () => ({ mutate: vi.fn<() => void>() }),
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
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
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
/** Renders the selection toolbar on a user album and opens its photo actions menu. */
async function openActionsMenu(props: Partial<Props>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <SelectionActions
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
          {...props}
        />
      </MantineProvider>
    );
  });
  await act(async () => {
    defined(container.querySelectorAll("button")[1], "the second button").click();
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  const menuItem = (key: ParseKeys) =>
    Array.from(document.body.querySelectorAll('[role="menuitem"]'))
      .filter(item => item instanceof HTMLButtonElement)
      // An item with a note under its label (Hide, Archive) is named by aria-label.
      .find(item => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === i18n.t(key));
  return {
    menuItem,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("locked album selection actions", () => {
  // A lock protects the album's photo set: only "Remove from album" is gated;
  // the photos themselves can still be favorited, hidden, shared or deleted.
  it.each([true, false])("gates only removal from the album when locked=%s", async locked => {
    hooks.remove.mockClear();
    hooks.deleted.mockClear();
    const { menuItem, cleanup } = await openActionsMenu({ albumLocked: locked });
    try {
      const remove = defined(menuItem("selectionactions.removephotos"), "remove");
      expect(menuItem("selectionactions.deleted")?.disabled).toBe(false);
      for (const key of ["selectionactions.download", "selectionactions.favorite", "selectionactions.hide"] as const) {
        expect(menuItem(key)?.disabled).toBe(false);
      }
      if (locked) {
        expectDisabledWithReason(remove, i18n.t("useralbum.lockedCannotRemove"));
      } else {
        expect(remove.getAttribute("aria-disabled")).toBeNull();
      }
      await act(async () => remove.click());
      expect(hooks.remove).toHaveBeenCalledTimes(locked ? 0 : 1);
    } finally {
      await cleanup();
    }
  });

  // #2237: the item was disabled in a locked album and in select-all mode without saying which.
  it("says the album is locked when that is why removal is off", async () => {
    const { menuItem, cleanup } = await openActionsMenu({ albumLocked: true });
    try {
      const remove = defined(menuItem("selectionactions.removephotos"), "remove");
      // Hover, not focus: the menu moves focus itself, and its arrow keys skip a disabled item.
      expect(await hoverAndReadTooltip(remove)).toContain(i18n.t("useralbum.lockedCannotRemove"));
    } finally {
      await cleanup();
    }
  });

  it("says removal does not work with Select all", async () => {
    hooks.remove.mockClear();
    const { menuItem, cleanup } = await openActionsMenu({ selectAllMode: true, selectedItems: [] });
    try {
      const remove = defined(menuItem("selectionactions.removephotos"), "remove");
      expectDisabledWithReason(remove, "Not available with Select all");
      await act(async () => remove.click());
      expect(hooks.remove).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
