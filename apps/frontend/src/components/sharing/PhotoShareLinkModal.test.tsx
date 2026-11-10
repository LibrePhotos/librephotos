/**
 * The lightbox's share-link dialog (issue #2028).
 *
 * The link is shown with a copy button instead of being copied after the
 * request returns: by then the click that started it is gone, and Safari
 * refuses the clipboard write.
 *
 * The link was made by an effect on open, twice under StrictMode, and a failed
 * replace cleared it and said "failed" although the old link still worked.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { usePhotoShareMutation } from "../../api_client/photos/hooks/usePhotoShareMutation";
import i18n from "../../i18n";
import { PhotoShareLinkModal } from "./PhotoShareLinkModal";

// The part of the real hook's result the dialog reads, so a change to its
// mutate signatures fails the typecheck here too.
type ShareMutation = ReturnType<typeof usePhotoShareMutation>;
type ShareMutationFake = {
  mutate: Mock<ShareMutation["mutate"]>;
  mutateAsync: Mock<ShareMutation["mutateAsync"]>;
};

const mutation: ShareMutationFake = {
  mutate: vi.fn<ShareMutation["mutate"]>(),
  mutateAsync: vi.fn<ShareMutation["mutateAsync"]>(),
};

const LINK = { enabled: true, slug: "abc", url: "/public/p/abc" };

vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "https://photos.example" }));
vi.mock("../../api_client/photos/hooks", () => ({ usePhotoShareMutation: () => mutation }));

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
  mutation.mutate.mockReset();
  mutation.mutateAsync.mockReset().mockResolvedValue(LINK);
});

async function renderModal(photoId: string | null, onClose = vi.fn<() => void>()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <React.StrictMode>
        <MantineProvider env="test">
          <PhotoShareLinkModal photoId={photoId} onClose={onClose} />
        </MantineProvider>
      </React.StrictMode>
    );
  });
  return { onClose };
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent === label);
  if (!button) {
    throw new Error(`no button named "${label}"`);
  }
  return button;
}

/** The confirm button in the open confirmation popover, labelled like its trigger. */
function confirmButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector(`[role="dialog"][aria-label="${label}"]`);
  const button = Array.from(dialog?.querySelectorAll("button") ?? []).find(b => b.textContent === label);
  if (!button) {
    throw new Error(`no confirmation button named "${label}"`);
  }
  return button;
}

describe("PhotoShareLinkModal", () => {
  it("creates the link once when opened, under StrictMode too, without touching anything else", async () => {
    await renderModal("photo-1");

    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutation.mutateAsync).toHaveBeenCalledWith({ photoId: "photo-1", action: "enable" });
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("shows the full link so it can be copied from a fresh click", async () => {
    await renderModal("photo-1");

    expect(document.querySelector("input")?.value).toBe("https://photos.example/public/p/abc");
  });

  it("replaces and revokes through the same mutation, closing after a revoke", async () => {
    const { onClose } = await renderModal("photo-1");
    mutation.mutateAsync.mockClear().mockResolvedValue({ ...LINK, url: "/public/p/new" });

    // Both end the link recipients already have, so each asks first.
    await act(async () => buttonNamed(i18n.t("sharing.rotateLink")).click());
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    await act(async () => confirmButton(i18n.t("sharing.rotateLink")).click());
    expect(mutation.mutateAsync).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "rotate" });
    expect(document.querySelector("input")?.value).toBe("https://photos.example/public/p/new");

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink")).click());
    expect(mutation.mutate).not.toHaveBeenCalled();
    await act(async () => confirmButton(i18n.t("sharing.revokeLink")).click());
    expect(mutation.mutate).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "disable" }, { onSuccess: onClose });
  });

  it("keeps showing the old link, which still works, when replacing it fails", async () => {
    await renderModal("photo-1");
    mutation.mutateAsync.mockRejectedValue(new Error("refused"));

    await act(async () => buttonNamed(i18n.t("sharing.rotateLink")).click());
    await act(async () => confirmButton(i18n.t("sharing.rotateLink")).click());

    expect(document.querySelector("input")?.value).toBe("https://photos.example/public/p/abc");
    expect(document.body.textContent).toContain(i18n.t("sharing.rotateLinkFailed"));
    expect(document.body.textContent).not.toContain(i18n.t("sharing.photoLinkFailed"));
  });

  it("leaves the link alone when the confirmation is cancelled", async () => {
    await renderModal("photo-1");
    mutation.mutateAsync.mockClear();

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink")).click());
    expect(document.body.textContent).toContain(i18n.t("sharing.revokeLinkConfirm"));
    const dialog = document.querySelector(`[role="dialog"][aria-label="${i18n.t("sharing.revokeLink")}"]`);
    const cancel = Array.from(dialog?.querySelectorAll("button") ?? []).find(b => b.textContent === i18n.t("cancel"));
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());

    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  // The Modal hears Escape on window first: without an opt-out on the focused
  // button it closed the whole share dialog along with the confirmation.
  it("closes only the confirmation on Escape", async () => {
    const { onClose } = await renderModal("photo-1");

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink")).click());
    const cancel = buttonNamed(i18n.t("cancel"));
    cancel.focus();
    await act(async () => {
      cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(i18n.t("sharing.revokeLinkConfirm"));
    expect(mutation.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ action: "disable" }), expect.anything());
  });

  it("says so when the link could not be created", async () => {
    mutation.mutateAsync.mockRejectedValue(new Error("refused"));

    await renderModal("photo-1");

    expect(document.body.textContent).toContain(i18n.t("sharing.photoLinkFailed"));
    expect(document.querySelector("input")).toBeNull();
  });

  it("does nothing while closed", async () => {
    await renderModal(null);

    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });
});
