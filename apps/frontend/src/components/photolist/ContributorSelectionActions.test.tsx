/**
 * A contributor in an album shared with them (#464) takes out only the photos they added: the
 * button says why when the selection holds someone else's photo, select-all or a locked album.
 */
import type { PigPhoto } from "@librephotos/api-client";
import { Media } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useRemovePhotosFromSharedAlbumMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { contributorRemoveReason, ContributorSelectionActions } from "./ContributorSelectionActions";

const stubs = vi.hoisted(() => ({
  remove: vi.fn<ReturnType<typeof useRemovePhotosFromSharedAlbumMutation>["mutate"]>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useRemovePhotosFromSharedAlbumMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 9, isAuthenticated: true }) }));

const ben = { id: 9, username: "ben", first_name: "Ben", last_name: "Okafor" };
const anna = { id: 1, username: "anna", first_name: "Anna", last_name: "Berger" };

const photo = (id: string, owner: typeof ben): PigPhoto => ({
  id,
  image_hash: id,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  owner,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.remove.mockReset();
});

describe("contributorRemoveReason", () => {
  const t = i18n.t.bind(i18n);
  const reason = (selectedItems: PigPhoto[], extra: { selectAllMode?: boolean; albumLocked?: boolean } = {}) =>
    contributorRemoveReason(
      t,
      { selectedItems, selectAllMode: extra.selectAllMode ?? false, albumLocked: extra.albumLocked ?? false },
      9
    );

  it("lets a contributor remove their own photos", () => {
    expect(reason([photo("b1", ben), photo("b2", ben)])).toBeUndefined();
  });

  it("says why it cannot", () => {
    expect(reason([photo("b1", ben), photo("a1", anna)])).toBe("You can only remove photos you added");
    expect(reason([])).toBe(i18n.t("selectionactions.selectphotosfirst"));
    expect(reason([photo("b1", ben)], { selectAllMode: true })).toBe("Select the photos one by one to remove them");
    expect(reason([photo("b1", ben)], { albumLocked: true })).toBe(i18n.t("useralbum.lockedCannotRemove"));
  });
});

describe("ContributorSelectionActions", () => {
  it("removes the selected photos of the contributor", async () => {
    await renderInMantine(
      <ContributorSelectionActions
        selectedItems={[photo("b1", ben)]}
        selectAllMode={false}
        albumID="40"
        albumLocked={false}
        title="Bruno and Mila"
        updateSelectionState={() => {}}
      />
    );
    await click(defined(document.querySelector("button"), "the button"));
    expect(stubs.remove).toHaveBeenCalledWith(
      { albumId: "40", title: "Bruno and Mila", photoIds: ["b1"] },
      expect.anything()
    );
  });

  it("does nothing for a photo someone else added", async () => {
    await renderInMantine(
      <ContributorSelectionActions
        selectedItems={[photo("a1", anna)]}
        selectAllMode={false}
        albumID="40"
        albumLocked={false}
        title="Bruno and Mila"
        updateSelectionState={() => {}}
      />
    );
    const button = defined(document.querySelector("button"), "the button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await click(button);
    expect(stubs.remove).not.toHaveBeenCalled();
  });
});
