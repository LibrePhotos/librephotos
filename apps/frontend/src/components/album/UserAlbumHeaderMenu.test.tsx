/**
 * The owner's "⋮" on an album page (#2208): Rename, Sharing, Lock / Unlock and Delete album open
 * My Albums' dialogs for this album; the rename's duplicate check leaves this album's own title
 * out, and deleting goes back to My Albums once the album is gone.
 */
import type { UserAlbum } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import type { UseNavigateResult } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToggleUserAlbumLockedParams } from "../../api_client/albums/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { UserAlbumHeaderMenu } from "./UserAlbumHeaderMenu";
import type { DeleteUserAlbumModal, RenameUserAlbumModal } from "./UserAlbumModals";

type RenameProps = React.ComponentProps<typeof RenameUserAlbumModal>;
type DeleteProps = React.ComponentProps<typeof DeleteUserAlbumModal>;
type ShareProps = React.ComponentProps<typeof ModalAlbumShare>;

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  toggleLocked: vi.fn<(params: ToggleUserAlbumLockedParams) => void>(),
  rename: undefined as RenameProps | undefined,
  remove: undefined as DeleteProps | undefined,
  share: undefined as ShareProps | undefined,
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
vi.mock("../sharing/ModalAlbumShare", () => ({
  ModalAlbumShare: (props: ShareProps) => {
    stubs.share = props;
    return null;
  },
}));

const owner = { id: 1, username: "maria", first_name: "Maria", last_name: "Santos" };
const lisbon = { id: 7, title: "Lisbon 2026", locked: false, owner } satisfies Partial<UserAlbum>;

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

async function render(locked = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <UserAlbumHeaderMenu album={{ ...lisbon, locked }} />
      </MantineProvider>
    )
  );
}

beforeEach(() => {
  stubs.navigate.mockReset();
  stubs.toggleLocked.mockReset();
  stubs.rename = undefined;
  stubs.remove = undefined;
  stubs.share = undefined;
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
  it("offers rename, sharing, lock and delete", async () => {
    await render();
    await act(async () => button("Album actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual(["Rename", "Sharing", "Lock album", "Delete album"]);
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
