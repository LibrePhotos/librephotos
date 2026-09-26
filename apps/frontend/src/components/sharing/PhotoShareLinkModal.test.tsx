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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PhotoShareLinkModal } from "./PhotoShareLinkModal";

const mutation = {
  mutate: vi.fn(),
  reset: vi.fn(),
  data: undefined as { enabled: boolean; slug: string | null; url: string | null } | undefined,
  isPending: false,
  isError: false,
};

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "", shareAddress: "https://photos.example" }));
vi.mock("../../api_client/photos/hooks", () => ({ usePhotoShareMutation: () => mutation }));

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
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

async function renderModal(photoId: string | null, onClose = vi.fn()) {
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

function buttonNamed(label: string) {
  return Array.from(document.querySelectorAll("button")).find(b => b.textContent === label);
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

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("https://photos.example/public/p/abc");
  });

  it("replaces and revokes through the same mutation, closing after a revoke", async () => {
    mutation.data = { enabled: true, slug: "abc", url: "/public/p/abc" };
    const { onClose } = await renderModal("photo-1");

    await act(async () => buttonNamed(i18n.t("sharing.rotateLink"))!.click());
    expect(mutation.mutate).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "rotate" });

    await act(async () => buttonNamed(i18n.t("sharing.revokeLink"))!.click());
    expect(mutation.mutate).toHaveBeenLastCalledWith({ photoId: "photo-1", action: "disable" }, { onSuccess: onClose });
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
