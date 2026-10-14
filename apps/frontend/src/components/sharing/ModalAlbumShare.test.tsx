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

const stubs = vi.hoisted(() => ({
  togglePublic: vi.fn<TogglePublic>(),
  album: { public: true, public_slug: "summer-in-lisbon" },
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useToggleUserAlbumPublicMutation: () => ({ mutate: stubs.togglePublic, isPending: false }),
  useFetchUserAlbumQuery: () => ({ data: stubs.album, refetch: () => Promise.resolve() }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: [], isFetching: false, isSuccess: true }),
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
  onRequestClose.mockReset();
  stubs.album = { public: true, public_slug: "summer-in-lisbon" };
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
