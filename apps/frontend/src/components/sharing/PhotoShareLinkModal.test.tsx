/**
 * The lightbox's share-link dialog (issue #2028).
 *
 * The link is shown with a copy button instead of being copied after the
 * request returns: by then the click that started it is gone, and Safari
 * refuses the clipboard write.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { usePhotoShareMutation } from "../../api_client/photos/hooks/usePhotoShareMutation";
import i18n from "../../i18n";
import { PhotoShareLinkModal } from "./PhotoShareLinkModal";

// The part of the real hook's result the dialog reads, so a change to its
// mutate/data signature fails the typecheck here too.
type ShareMutation = ReturnType<typeof usePhotoShareMutation>;
type ShareMutationFake = Pick<ShareMutation, "data" | "isPending" | "isError"> & {
  mutate: Mock<ShareMutation["mutate"]>;
  reset: Mock<ShareMutation["reset"]>;
};

const mutation: ShareMutationFake = {
  mutate: vi.fn<ShareMutation["mutate"]>(),
  reset: vi.fn<ShareMutation["reset"]>(),
  data: undefined,
  isPending: false,
  isError: false,
};

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "", shareAddress: "https://photos.example" }));
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
  mutation.reset.mockReset();
  mutation.data = undefined;
  mutation.isPending = false;
  mutation.isError = false;
});

async function renderModal(photoId: string | null, onClose = vi.fn<() => void>()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <PhotoShareLinkModal photoId={photoId} onClose={onClose} />
      </MantineProvider>
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
  it("creates the link when opened, without touching anything else", async () => {
    await renderModal("photo-1");

    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mutation.mutate).toHaveBeenCalledWith({ photoId: "photo-1", action: "enable" });
  });

  it("shows the full link so it can be copied from a fresh click", async () => {
    mutation.data = { enabled: true, slug: "abc", url: "/public/p/abc" };

    await renderModal("photo-1");

    expect(document.querySelector("input")?.value).toBe("https://photos.example/public/p/abc");
  });

  it("replaces and revokes through the same mutation, closing after a revoke", async () => {
    mutation.data = { enabled: true, slug: "abc", url: "/public/p/abc" };
    const { onClose } = await renderModal("photo-1");
    mutation.mutate.mockClear();

    // Both end the link recipients already have, so each asks first.
    await act(async () => buttonNamed(i18n.t("sharing.rotateLink")).click());
    expect(mutation.mutate).not.toHaveBeenCalled();
    await act(async () => confirmButton(i18n.t("sharing.rotateLink")).click());
    expect(mutation.mutate).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "rotate" });

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink")).click());
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    await act(async () => confirmButton(i18n.t("sharing.revokeLink")).click());
    expect(mutation.mutate).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "disable" }, { onSuccess: onClose });
  });

  it("leaves the link alone when the confirmation is cancelled", async () => {
    mutation.data = { enabled: true, slug: "abc", url: "/public/p/abc" };
    await renderModal("photo-1");
    mutation.mutate.mockClear();

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink")).click());
    expect(document.body.textContent).toContain(i18n.t("sharing.revokeLinkConfirm"));
    const dialog = document.querySelector(`[role="dialog"][aria-label="${i18n.t("sharing.revokeLink")}"]`);
    const cancel = Array.from(dialog?.querySelectorAll("button") ?? []).find(b => b.textContent === i18n.t("cancel"));
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());

    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  // The Modal hears Escape on window first: without an opt-out on the focused
  // button it closed the whole share dialog along with the confirmation.
  it("closes only the confirmation on Escape", async () => {
    mutation.data = { enabled: true, slug: "abc", url: "/public/p/abc" };
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
    mutation.isError = true;

    await renderModal("photo-1");

    expect(document.body.textContent).toContain(i18n.t("sharing.photoLinkFailed"));
    expect(document.querySelector("input")).toBeNull();
  });

  it("does nothing while closed", async () => {
    await renderModal(null);

    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(mutation.reset).toHaveBeenCalled();
  });
});
