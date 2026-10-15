/**
 * The owner's "⋮" on an album page (#2208): Rename, Sharing, Lock / Unlock and Delete album open
 * My Albums' dialogs for this album; the rename's duplicate check leaves this album's own title
 * out, and deleting goes back to My Albums once the album is gone. With uploads on, "Upload to this
 * album…" comes first (#612), and says why when the album cannot take uploads. "Set as cover…"
 * picks the cover from the album's loaded photos without selecting anything (#2240).
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto, UserAlbum } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import type { UseNavigateResult } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetUserAlbumCoverParams, ToggleUserAlbumLockedParams } from "../../api_client/albums/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import type { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import type { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import type { AlbumUpload } from "../upload/useAlbumUpload";
import type { AlbumCollectionsModal } from "./AlbumCollectionsModal";
import { UserAlbumHeaderMenu } from "./UserAlbumHeaderMenu";
import type { DeleteUserAlbumModal, RenameUserAlbumModal } from "./UserAlbumModals";

type RenameProps = React.ComponentProps<typeof RenameUserAlbumModal>;
type DeleteProps = React.ComponentProps<typeof DeleteUserAlbumModal>;
type ShareProps = React.ComponentProps<typeof ModalAlbumShare>;
type CollectionsProps = React.ComponentProps<typeof AlbumCollectionsModal>;
type CoverProps = React.ComponentProps<typeof AlbumCoverPickerModal>;

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  toggleLocked: vi.fn<(params: ToggleUserAlbumLockedParams) => void>(),
  setCover: vi.fn<(params: SetUserAlbumCoverParams) => void>(),
  cover: undefined as CoverProps | undefined,
  rename: undefined as RenameProps | undefined,
  remove: undefined as DeleteProps | undefined,
  share: undefined as ShareProps | undefined,
  collections: undefined as CollectionsProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchUserAlbumsQuery: () => ({
    data: [
      { id: 7, title: "Lisbon 2026" },
      { id: 8, title: "Porto" },
    ],
  }),
  useToggleUserAlbumLockedMutation: () => ({ mutate: stubs.toggleLocked }),
  useSetUserAlbumCoverMutation: () => ({ mutate: stubs.setCover }),
}));
vi.mock("../modals/AlbumCoverPickerModal", () => ({
  AlbumCoverPickerModal: (props: CoverProps) => {
    stubs.cover = props;
    return null;
  },
}));
// The dialogs have their own tests; here it matters what they are opened with.
vi.mock("./UserAlbumModals", () => ({
  RenameUserAlbumModal: (props: RenameProps) => {
    stubs.rename = props;
    return null;
  },
  DeleteUserAlbumModal: (props: DeleteProps) => {
    stubs.remove = props;
    return null;
  },
}));
vi.mock("./AlbumCollectionsModal", () => ({
  AlbumCollectionsModal: (props: CollectionsProps) => {
    stubs.collections = props;
    return null;
  },
}));
vi.mock("../sharing/ModalAlbumShare", () => ({
  ModalAlbumShare: (props: ShareProps) => {
    stubs.share = props;
    return null;
  },
}));

const owner = { id: 1, username: "maria", first_name: "Maria", last_name: "Santos" };
const lisbon = { id: 7, title: "Lisbon 2026", locked: false, owner, collection_ids: [3] } satisfies Partial<UserAlbum>;
const tile = (id: string, isTemp = false): PigPhoto => ({
  id,
  image_hash: id,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp,
  has_raw_variant: false,
});
// A loaded photo and the placeholder of one that is not
const photos = [tile("p1"), tile("0", true)];

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

let root: Root | undefined;

const openPicker = vi.fn<() => void>();

async function render(locked = false, upload: AlbumUpload | null = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <UserAlbumHeaderMenu album={{ ...lisbon, locked }} upload={upload} photos={photos} />
      </MantineProvider>
    )
  );
}

beforeEach(() => {
  stubs.navigate.mockReset();
  stubs.toggleLocked.mockReset();
  stubs.setCover.mockReset();
  stubs.cover = undefined;
  stubs.rename = undefined;
  stubs.remove = undefined;
  stubs.share = undefined;
  openPicker.mockReset();
  stubs.collections = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

async function pick(item: string) {
  await act(async () => button("Album actions").click());
  await act(async () => button(item).click());
}

describe("UserAlbumHeaderMenu", () => {
  it("offers rename, set as cover, sharing, collections, lock and delete", async () => {
    await render();
    await act(async () => button("Album actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual(["Rename", "Set as cover…", "Sharing", "Collections…", "Lock album", "Delete album"]);
  });

  it("picks the cover from the loaded photos, with nothing selected (#2240)", async () => {
    await render();
    expect(stubs.cover?.isOpen).toBe(false);

    await pick("Set as cover…");

    const cover = defined(stubs.cover);
    expect(cover).toMatchObject({ isOpen: true, albumTitle: "Lisbon 2026" });
    expect(cover.photos.map(photo => photo.id)).toEqual(["p1"]);
    act(() => cover.onSelectCover("p1"));
    expect(stubs.setCover).toHaveBeenCalledWith({ id: "7", photo: "p1" });
  });

  it("opens the collections checklist with the album's collections (#1009)", async () => {
    await render();
    await pick("Collections…");

    expect(stubs.collections).toMatchObject({
      opened: true,
      albumId: "7",
      albumTitle: "Lisbon 2026",
      collectionIds: [3],
    });
  });

  it("offers Upload to this album first when uploads are on (#612)", async () => {
    await render(false, { open: openPicker, reason: null, inputProps: {} });
    await act(async () => button("Album actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual([
      "Upload to this album…",
      "Rename",
      "Set as cover…",
      "Sharing",
      "Collections…",
      "Lock album",
      "Delete album",
    ]);
    await act(async () => button("Upload to this album…").click());
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("says why the album takes no uploads", async () => {
    const reason = "Lisbon 2026 is locked. Unlock it to add photos.";
    await render(true, { open: openPicker, reason, inputProps: {} });
    await act(async () => button("Album actions").click());

    const upload = button("Upload to this album…");
    expectDisabledWithReason(upload, reason);
    await act(async () => upload.click());
    expect(openPicker).not.toHaveBeenCalled();
  });

  it("renames with every other album's title taken, not this one's", async () => {
    await render();
    expect(stubs.rename?.opened).toBe(false);

    await pick("Rename");

    const rename = defined(stubs.rename);
    expect(rename.opened).toBe(true);
    expect(rename).toMatchObject({ albumId: "7", albumTitle: "Lisbon 2026", existingTitles: ["Porto"] });
  });

  it("opens the sharing dialog for this album", async () => {
    await render();
    await pick("Sharing");

    expect(stubs.share).toMatchObject({ isOpen: true, albumID: "7", ownerUsername: "maria" });
  });

  it.each([
    [false, "Lock album", true],
    [true, "Unlock album", false],
  ])("a locked=%s album offers %s", async (locked, item, next) => {
    await render(locked);
    await pick(item);

    expect(stubs.toggleLocked).toHaveBeenCalledWith({ id: "7", locked: next });
  });

  it("deletes through My Albums' dialog, then goes to My Albums", async () => {
    await render();
    await pick("Delete album");

    const remove = defined(stubs.remove);
    expect(remove).toMatchObject({ opened: true, albumId: "7", albumTitle: "Lisbon 2026" });
    expect(stubs.navigate).not.toHaveBeenCalled();
    act(() => remove.onDeleted?.());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/user" });
  });

  it("hands focus back to the menu button when a dialog closes", async () => {
    await render();
    await pick("Rename");

    act(() => defined(stubs.rename).onClose());

    expect(stubs.rename?.opened).toBe(false);
    expect(document.activeElement).toBe(button("Album actions"));
  });
});
