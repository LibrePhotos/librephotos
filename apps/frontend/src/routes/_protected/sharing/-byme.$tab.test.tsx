/**
 * "Photos you shared" counted user groups as photos ("2 photo share(s) with 2
 * user(s)" for 40 photos), nested its subtitle <p> in another <p>, and its
 * uncontrolled tabs kept showing the other tab after the Back button changed
 * the route.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  params: { tab: "photos" },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return { useParams: () => stubs.params };
  },
  useNavigate: () => stubs.navigate,
}));
vi.mock("../../../api_client/albums/hooks", () => {
  const result = {
    data: [
      { user_id: 2, albums: [{ id: 1 }, { id: 2 }] },
      { user_id: 3, albums: [{ id: 1 }] },
    ],
  };
  return { useFetchSharedAlbumsByMeQuery: () => result };
});
vi.mock("../../../api_client/photos/hooks", () => {
  // One photo went to both users: three photos, two users.
  const result = {
    data: [
      { userId: 2, photos: [{ id: "a" }, { id: "b" }] },
      { userId: 3, photos: [{ id: "b" }, { id: "c" }] },
    ],
  };
  return { useFetchSharedPhotosByMeQuery: () => result };
});
vi.mock("../../../components/sharing/AlbumsSharedByMe", () => ({ AlbumsSharedByMe: () => null }));
vi.mock("../../../components/sharing/PhotoSharesSection", () => ({ PhotoSharesSection: () => null }));
vi.mock("../../../components/sharing/PhotosSharedByMe", () => ({ PhotosSharedByMe: () => null }));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

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
  await import("./byme.$tab");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderAt(tab: string) {
  stubs.params = { tab };
  const SharedByMe = stubs.component!;
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <MantineProvider env="test">
        <SharedByMe />
      </MantineProvider>
    );
  });
}

const selectedTab = () => container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

describe("photos and albums you shared", () => {
  it("counts each shared photo once, and the users it went to", async () => {
    await renderAt("photos");

    expect(container.textContent).toContain("3 photos shared with 2 users");
  });

  it("counts each shared album once", async () => {
    await renderAt("albums");

    expect(container.textContent).toContain("You shared 2 albums");
  });

  it("does not nest the subtitle paragraph in another one", async () => {
    await renderAt("photos");

    expect(container.querySelector("p p")).toBeNull();
  });

  it("shows the tab the route names, also after Back changed it", async () => {
    await renderAt("albums");
    expect(selectedTab()).toBe(i18n.t("sidemenu.albums"));

    await renderAt("photos");
    expect(selectedTab()).toBe(i18n.t("sidemenu.photos"));
    expect(container.textContent).toContain(i18n.t("sharing.photosYouShared"));
  });
});
