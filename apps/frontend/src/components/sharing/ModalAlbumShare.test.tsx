/**
 * #2223: the public sharing switch saved on one click. Turning it off drops the album's
 * link for good (the backend mints a new one on the next enable), so a custom URL that
 * was handed out cannot be restored: that direction asks first, turning sharing on does not.
 *
 * The album and slideshow links (#1457) show only while public sharing is on.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { ModalAlbumShare } from "./ModalAlbumShare";

type TogglePublic = (
  variables: { albumId: string; public: boolean },
  options?: { onSuccess?: () => Promise<unknown> | void }
) => void;
type Share = (
  variables: { albumId: string; userId: string; share: boolean; role?: string },
  options?: { onSuccess?: () => void }
) => void;
type SetCeiling = (variables: { albumId: string; ceiling: Record<string, boolean> }) => void;

type StubAlbum = {
  public: boolean;
  public_slug: string;
  title?: string;
  members?: { user: { id: number }; role: "viewer" | "contributor"; photo_count: number }[];
  shared_to?: { id: number }[];
  members_share_location?: boolean;
};

const ben = { id: 2, username: "ben", first_name: "Ben", last_name: "Okafor", date_joined: null };
const clara = { id: 3, username: "clara", first_name: "Clara", last_name: "Ruiz", date_joined: null };

const stubs = vi.hoisted(() => ({
  togglePublic: vi.fn<TogglePublic>(),
  share: vi.fn<Share>(),
  setCeiling: vi.fn<SetCeiling>(),
  album: { public: true, public_slug: "summer-in-lisbon" } as StubAlbum,
  users: [] as unknown[],
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useToggleUserAlbumPublicMutation: () => ({ mutate: stubs.togglePublic, isPending: false }),
  useFetchUserAlbumQuery: () => ({ data: stubs.album, refetch: () => Promise.resolve() }),
  useShareUserAlbumMutation: () => ({ mutate: stubs.share, isPending: false }),
  useSetAlbumMemberCeilingMutation: () => ({ mutate: stubs.setCeiling, isPending: false }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: stubs.users, isFetching: false, isSuccess: true }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 1 } }),
}));
// The album and slideshow links (AlbumSlugSection.test.tsx); here only whether they show.
vi.mock("./AlbumSlugSection", () => ({ AlbumSlugSection: () => <div data-testid="public-links" /> }));

const onRequestClose = vi.fn<() => void>();

async function renderShareDialog() {
  await renderInMantine(<ModalAlbumShare isOpen onRequestClose={onRequestClose} albumID="5" />);
}

function publicSwitch(): HTMLInputElement {
  return defined(
    document.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t("modalalbumsshare.publicsharing")}"]`),
    "the public sharing switch"
  );
}

/** The confirmation stacked on the share dialog, not the share dialog itself. */
function confirmation(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(dialog =>
    dialog.textContent?.includes("Turn off public sharing?")
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.togglePublic.mockReset();
  stubs.share.mockReset();
  stubs.setCeiling.mockReset();
  onRequestClose.mockReset();
  stubs.album = { public: true, public_slug: "summer-in-lisbon" };
  stubs.users = [];
});

describe("ModalAlbumShare public sharing switch", () => {
  it("asks before turning sharing off, naming the link that stops working", async () => {
    await renderShareDialog();

    await click(publicSwitch());

    expect(confirmation()?.textContent).toContain("/public/s/summer-in-lisbon stops working and cannot be restored");
    expect(stubs.togglePublic).not.toHaveBeenCalled();
  });

  it("keeps sharing on when the owner says so", async () => {
    await renderShareDialog();
    await click(publicSwitch());

    await click(dialogButton("Keep sharing"));

    expect(stubs.togglePublic).not.toHaveBeenCalled();
    expect(confirmation()).toBeUndefined();
  });

  it("turns sharing off once confirmed", async () => {
    await renderShareDialog();
    await click(publicSwitch());

    await click(dialogButton("Turn off sharing"));

    expect(stubs.togglePublic).toHaveBeenCalledWith({ albumId: "5", public: false }, expect.anything());
    const onSuccess = defined(defined(stubs.togglePublic.mock.calls[0])[1]?.onSuccess);
    await act(async () => {
      await onSuccess();
    });
    expect(confirmation()).toBeUndefined();
  });

  it("closes only the confirmation on Escape, not the share dialog under it", async () => {
    await renderShareDialog();
    await click(publicSwitch());

    await act(async () => {
      defined(confirmation()).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(confirmation()).toBeUndefined();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("turns sharing on at once", async () => {
    stubs.album = { public: false, public_slug: "" };
    await renderShareDialog();

    await click(publicSwitch());

    expect(stubs.togglePublic).toHaveBeenCalledWith({ albumId: "5", public: true }, expect.anything());
    expect(openDialog()?.textContent).not.toContain("Turn off public sharing?");
  });
});

describe("ModalAlbumShare public links (#1457)", () => {
  const links = () => document.querySelector('[data-testid="public-links"]');

  it("shows the album and slideshow links while the album is public", async () => {
    await renderShareDialog();

    expect(links()).not.toBeNull();
  });

  it("shows no link while public sharing is off", async () => {
    stubs.album = { public: false, public_slug: "" };
    await renderShareDialog();

    expect(links()).toBeNull();
  });
});

describe("ModalAlbumShare roles (#464)", () => {
  /** The role select of one user, by its accessible name. */
  function roleSelect(name: string): HTMLInputElement {
    return defined(
      document.querySelector<HTMLInputElement>(`input[aria-label="Role for ${name}"]`),
      `the role select of ${name}`
    );
  }

  async function pick(name: string, option: string) {
    const input = roleSelect(name);
    await click(input);
    const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
    const choice = [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
      element => element.textContent === option
    );
    await click(defined(choice, `the option ${option}`));
  }

  beforeAll(() => {
    // jsdom has no scrollIntoView, which the Select's dropdown calls on the picked option
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    stubs.users = [ben, clara];
    stubs.album = {
      public: false,
      public_slug: "",
      title: "Bruno and Mila",
      members: [{ user: { id: 2 }, role: "contributor", photo_count: 34 }],
      shared_to: [{ id: 2 }],
      members_share_location: false,
    };
  });

  it("shows each user's role", async () => {
    await renderShareDialog();

    expect(roleSelect("Ben Okafor").value).toBe("Can add photos");
    expect(roleSelect("Clara Ruiz").value).toBe("No access");
  });

  it("gives a role at once", async () => {
    await renderShareDialog();

    await pick("Clara Ruiz", "Can view");

    expect(stubs.share).toHaveBeenCalledWith(
      { albumId: "5", userId: "3", share: true, role: "viewer" },
      expect.anything()
    );
  });

  it("asks before taking a contributor's photos out, saying how many", async () => {
    await renderShareDialog();

    await pick("Ben Okafor", "No access");

    expect(stubs.share).not.toHaveBeenCalled();
    expect(openDialog()?.textContent).toContain("Remove Ben Okafor from Bruno and Mila?");
    expect(openDialog()?.textContent).toContain("The 34 photos Ben Okafor added leave the album");

    await click(dialogButton("Remove"));

    expect(stubs.share).toHaveBeenCalledWith(
      { albumId: "5", userId: "2", share: false, role: undefined },
      expect.anything()
    );
  });

  it("shows the owner's ceiling and saves a change at once", async () => {
    await renderShareDialog();
    const location = defined(
      [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        input => input.closest("label")?.textContent === "Location"
      ),
      "the Location switch"
    );
    expect(location.checked).toBe(false);

    await click(location);

    expect(stubs.setCeiling).toHaveBeenCalledWith({ albumId: "5", ceiling: { members_share_location: true } });
  });
});
