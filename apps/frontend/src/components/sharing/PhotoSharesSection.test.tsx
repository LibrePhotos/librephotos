import type { PhotoShare, PhotoShareLink } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { usePhotoShareMutation } from "../../api_client/photos/hooks/usePhotoShareMutation";
import i18n from "../../i18n";
import { PhotoSharesSection } from "./PhotoSharesSection";

type ShareMutation = ReturnType<typeof usePhotoShareMutation>;

const state = vi.hoisted(() => ({ shares: [] as PhotoShareLink[] }));
const mutation: {
  mutate: Mock<ShareMutation["mutate"]>;
  mutateAsync: Mock<ShareMutation["mutateAsync"]>;
  isPending: boolean;
  variables: undefined;
} = {
  mutate: vi.fn<ShareMutation["mutate"]>(),
  mutateAsync: vi.fn<ShareMutation["mutateAsync"]>(),
  isPending: false,
  variables: undefined,
};

vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "https://photos.example" }));
vi.mock("../common/MediaThumbnail", () => ({ MediaThumbnail: () => null }));
vi.mock("../../api_client/photos/hooks", () => ({
  usePhotoShareMutation: () => mutation,
  useFetchPhotoSharesQuery: () => ({ data: state.shares, isLoading: false }),
}));

function link(slug: string, expiresAt: string | null): PhotoShareLink {
  return {
    enabled: true,
    slug,
    url: `/public/p/${slug}`,
    expires_at: expiresAt,
    created_at: "2026-11-01T10:00:00Z",
    photo_id: `photo-${slug}`,
    image_hash: `hash-${slug}`,
  };
}

const unmounts: Array<() => void> = [];

beforeAll(async () => {
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
  mutation.mutate.mockReset();
  mutation.mutateAsync.mockReset();
});

afterEach(() => {
  while (unmounts.length) unmounts.pop()?.();
  document.body.innerHTML = "";
});

async function renderSection() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <PhotoSharesSection />
      </MantineProvider>
    );
  });
  unmounts.push(() => act(() => root.unmount()));
  return container;
}

function rowOf(container: HTMLElement, slug: string): HTMLElement {
  const input = Array.from(container.querySelectorAll("input")).find(field => field.value.endsWith(`/p/${slug}`));
  const row = input?.closest<HTMLElement>(".mantine-Group-root");
  if (!row) throw new Error(`no row for ${slug}`);
  return row;
}

describe("PhotoSharesSection", () => {
  it("captions each link with when it expires, and an expired one with when it did", async () => {
    state.shares = [
      link("open", DateTime.now().plus({ days: 3, minutes: 1 }).toISO()),
      link("closed", DateTime.now().minus({ days: 2 }).toISO()),
      link("forever", null),
    ];

    const container = await renderSection();

    expect(rowOf(container, "open").textContent).toContain("Expires in 3 days");
    expect(rowOf(container, "closed").textContent).toContain("Expired 2 days ago");
    expect(rowOf(container, "forever").textContent).not.toMatch(/Expire/);
  });

  it("opens the share dialog of that photo to change or renew its expiry", async () => {
    const expired: PhotoShare = { ...link("closed", DateTime.now().minus({ days: 2 }).toISO()) };
    state.shares = [link("closed", expired.expires_at ?? null)];
    mutation.mutateAsync.mockResolvedValue(expired);
    const container = await renderSection();

    const change = rowOf(container, "closed").querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("sharing.changeExpiry")}"]`
    );
    await act(async () => change?.click());

    expect(mutation.mutateAsync).toHaveBeenCalledWith({ photoId: "photo-closed", action: "enable" });
    expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Visitors are told the link has expired");
  });

  it("still shows the QR code of an expired link, saying it opens the expiry notice", async () => {
    state.shares = [link("closed", DateTime.now().minus({ days: 2 }).toISO()), link("open", null)];
    const container = await renderSection();
    const qrOf = (slug: string) =>
      rowOf(container, slug).querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("sharing.showQrCode")}"]`);

    await act(async () => qrOf("closed")?.click());
    const expiredPanel = document.querySelector(`[role="dialog"][aria-label="${i18n.t("sharing.qrCode")}"]`);
    expect(expiredPanel?.querySelector("svg")).not.toBeNull();
    expect(expiredPanel?.textContent).toContain(i18n.t("sharing.qrCodeExpired"));
    await act(async () => qrOf("closed")?.click());

    await act(async () => qrOf("open")?.click());
    const openPanel = document.querySelector(`[role="dialog"][aria-label="${i18n.t("sharing.qrCode")}"]`);
    expect(openPanel?.textContent).not.toContain(i18n.t("sharing.qrCodeExpired"));
  });
});
