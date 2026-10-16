/**
 * "Remove from this person" in the selection menu (#2207): only on a person page, only for an
 * explicit selection (the person page's "Select all" is a server-side query the endpoint does not
 * take), and only after a confirmation. It sends the photos' ids, never their hashes.
 *
 * "Set album cover" there makes the one selected photo the cover; picking any photo without a
 * selection is the page's "⋮" (#2240), and the disabled item says so.
 */
import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useRemovePhotosFromPersonMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { addTempElementsToFlatList } from "../../util/util";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { SelectionActions } from "./SelectionActions";

type Props = React.ComponentProps<typeof SelectionActions>;
type RemoveFromPerson = ReturnType<typeof useRemovePhotosFromPersonMutation>["mutate"];

const stubs = vi.hoisted(() => ({ pathname: "/album/persons/5", removeFromPerson: vi.fn<RemoveFromPerson>() }));
const noopMutation = vi.hoisted(() => () => ({ mutate: () => {}, mutateAsync: async () => {} }));
// The Files items have their own tests (FileActionItems.test.tsx).
vi.mock("./FileActionItems", () => ({ FileActionItems: () => null, SelectionFileItems: () => null }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: stubs.pathname }) }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useRemovePhotoFromUserAlbumMutation: noopMutation,
  useRemovePhotosFromPersonMutation: () => ({ mutate: stubs.removeFromPerson }),
}));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: noopMutation }));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: noopMutation,
  useSetFavoritePhotosMutation: noopMutation,
  useSetPhotosRatingMutation: noopMutation,
  useSetPhotosHiddenMutation: noopMutation,
  useSetPhotosArchivedMutation: noopMutation,
  useSetPhotosPublicMutation: noopMutation,
  useSetPhotosCategoryMutation: noopMutation,
}));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: noopMutation,
  useMergeStacksMutation: noopMutation,
  useRemoveFromStackMutation: noopMutation,
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
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

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.pathname = "/album/persons/5";
  stubs.removeFromPerson.mockReset();
});

function photo(n: number) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return PigPhoto.parse({ id, image_hash: `hash${n}`, aspectRatio: 1 });
}

const updateSelectionState = vi.fn<Props["updateSelectionState"]>();

async function openMenu(props: Partial<Props>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <SelectionActions
          selectedItems={[]}
          updateSelectionState={updateSelectionState}
          onSharePhotos={() => {}}
          setAlbumCover={() => {}}
          onShareAlbum={() => {}}
          onAddToAlbum={() => {}}
          onAddTags={() => {}}
          title="Anna Becker"
          albumID="5"
          {...props}
        />
      </MantineProvider>
    );
  });
  await act(async () => defined(container.querySelectorAll("button")[1], "the photo actions button").click());
  return root;
}

function removeItem() {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    item => item.textContent?.trim() === "Remove from this person"
  );
}

describe("Remove from this person", () => {
  it("is offered on a person page", async () => {
    const root = await openMenu({ selectedItems: [photo(1)] });

    expect(defined(removeItem()).getAttribute("aria-disabled")).toBeNull();
    await act(async () => root.unmount());
  });

  it.each(["/album/user/5", "/"])("is not offered on %s", async pathname => {
    stubs.pathname = pathname;
    const root = await openMenu({ selectedItems: [photo(1)] });

    expect(removeItem()).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("is disabled after Select all", async () => {
    const root = await openMenu({ selectedItems: [], selectAllMode: true, selectAllQuery: { person: 5 } });

    expect(defined(removeItem()).getAttribute("aria-disabled")).toBe("true");
    await act(async () => root.unmount());
  });

  it("asks first, then sends the ids of the loaded photos", async () => {
    updateSelectionState.mockReset();
    const placeholder = defined(addTempElementsToFlatList(1)[0], "the placeholder");
    const root = await openMenu({ selectedItems: [photo(1), photo(2), placeholder] });

    await act(async () => defined(removeItem()).click());
    expect(stubs.removeFromPerson).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Remove 2 photos from Anna Becker?");

    const dialog = defined(document.body.querySelector('[role="dialog"]'), "the confirmation");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "Remove from this person"
    );
    await act(async () => defined(confirm).click());

    expect(stubs.removeFromPerson).toHaveBeenCalledWith({
      personId: "5",
      personName: "Anna Becker",
      photoIds: [photo(1).id, photo(2).id],
    });
    expect(updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: false }));
    await act(async () => root.unmount());
  });
});

describe("Set album cover in the selection menu (#2240)", () => {
  function coverItem() {
    return defined(
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
        item => item.textContent?.trim() === i18n.t("selectionactions.albumcover")
      ),
      "the cover item"
    );
  }

  it("sets the one selected photo and clears the selection", async () => {
    updateSelectionState.mockReset();
    const setAlbumCover = vi.fn<Props["setAlbumCover"]>();
    const root = await openMenu({ selectedItems: [photo(1)], setAlbumCover });

    await act(async () => coverItem().click());

    expect(setAlbumCover).toHaveBeenCalledWith("person");
    expect(updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: false }));
    await act(async () => root.unmount());
  });

  it.each([
    ["nothing", [], "selectionactions.albumcoverpickinmenu"],
    ["two photos", [photo(1), photo(2)], "selectionactions.albumcovermultiselect"],
  ] as const)("is off with %s selected and says why", async (_label, selectedItems, reason) => {
    const setAlbumCover = vi.fn<Props["setAlbumCover"]>();
    const root = await openMenu({ selectedItems: [...selectedItems], setAlbumCover });

    const item = coverItem();
    expectDisabledWithReason(item, i18n.t(reason));
    await act(async () => item.click());
    expect(setAlbumCover).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
