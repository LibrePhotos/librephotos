/**
 * Shared with you has a Places, Things and People tab next to Photos and Albums (#2721, #2722):
 * each tab names itself in the page header and says what it groups. A route's tab outside the
 * list reads as the Photos tab, as before.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  params: { tab: "photos" },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return { useParams: () => stubs.params };
  },
  useNavigate: () => () => {},
}));
vi.mock("../../../api_client/albums/hooks", () => {
  const result = { data: [{ user_id: 2, albums: [{ id: 1 }, { id: 2 }] }] };
  return { useFetchSharedAlbumsWithMeQuery: () => result };
});
vi.mock("../../../api_client/photos/hooks", () => {
  const result = { data: [{ userId: 2, photos: [{ id: "a" }, { id: "b" }, { id: "c" }] }] };
  return { useFetchSharedPhotosWithMeQuery: () => result };
});
vi.mock("../../../components/sharing/AlbumsSharedWithMe", () => ({ AlbumsSharedWithMe: () => null }));
vi.mock("../../../components/sharing/PhotosSharedWithMe", () => ({ PhotosSharedWithMe: () => null }));
vi.mock("../../../components/sharing/PeopleSharedWithMe", () => ({ PeopleSharedWithMe: () => null }));
vi.mock("../../../components/sharing/SharedGroupsWithMe", () => ({ SharedGroupsWithMe: () => null }));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

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
  await import("./withme.$tab");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderAt(tab: string) {
  stubs.params = { tab };
  const SharedWithMe = stubs.component;
  if (!SharedWithMe) throw new Error("the route registered no component");
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () =>
    mounted.render(
      <MantineProvider env="test">
        <SharedWithMe />
      </MantineProvider>
    )
  );
  return {
    title: container.querySelector("h1")?.textContent,
    tabs: Array.from(container.querySelectorAll('[role="tab"]'), tabElement => tabElement.textContent),
  };
}

describe("Shared with you", () => {
  it("has a tab for the places, things and people of the shared photos", async () => {
    const { tabs } = await renderAt("photos");

    expect(tabs).toEqual(["Photos", "Albums", "Places", "Things", "People"]);
  });

  it.each([
    ["places", "Places of photos others shared", "Where the photos shared with you were taken"],
    ["things", "Things on photos others shared", "What the photos shared with you show"],
    ["people", "People on photos others shared", "The people their owners named on the photos shared with you"],
  ])("names the %s tab and says what it groups", async (tab, title, description) => {
    const page = await renderAt(tab);

    expect(page.title).toBe(title);
    expect(container.textContent).toContain(description);
  });

  it("counts the photos and albums on their own tabs", async () => {
    const photos = await renderAt("photos");
    expect(photos.title).toBe("Photos others shared");
    expect(container.textContent).toContain("3 photos");
    await act(async () => root?.unmount());
    container.remove();

    const albums = await renderAt("albums");
    expect(albums.title).toBe("Albums others shared");
    expect(container.textContent).toContain("2 albums");
  });

  it("reads an unknown tab as the Photos tab", async () => {
    expect((await renderAt("nope")).title).toBe("Photos others shared");
  });
});
