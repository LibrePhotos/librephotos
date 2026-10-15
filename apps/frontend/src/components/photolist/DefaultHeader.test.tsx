/**
 * The grid header's counter glued a number to a fixed plural ("1 days",
 * "1 photos", and "4 photos" on the Videos page), and the title's view
 * switcher was an h2 that could only be opened with a mouse.
 */
import { MantineProvider } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { DefaultHeader } from "./DefaultHeader";

const route = vi.hoisted(() => ({ pathname: "/", isAdmin: false, scanDirectory: "/data" }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useRouter: () => ({ state: { location: { pathname: route.pathname } } }),
}));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1, is_admin: route.isAdmin, name: "admin" } } }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserSelfDetailsQuery: () => ({ data: { scan_directory: route.scanDirectory } }),
  useFetchUserListQuery: () => ({ data: [] }),
}));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));
vi.mock("../../api_client/duplicates", () => ({ useDuplicateStatsQuery: () => ({ data: undefined }) }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Partial<React.ComponentProps<typeof DefaultHeader>>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    defined(root).render(
      <MantineProvider env="test">
        <DefaultHeader
          loading={false}
          numPhotosetItems={1}
          numPhotos={1}
          icon={IconPhoto}
          title="Photos"
          additionalSubHeader={null}
          dayHeaderPrefix=""
          date=""
          {...props}
        />
      </MantineProvider>
    );
  });
  return container;
}

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

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  route.pathname = "/";
  route.isAdmin = false;
  route.scanDirectory = "/data";
});

describe("DefaultHeader counter", () => {
  it("uses the singular for one photo", async () => {
    expect((await render({ numPhotosetItems: 1, numPhotos: 1 })).textContent).toContain("1 photo");
    expect(defined(container).textContent).not.toContain("1 photos");
  });

  it("pluralises days and photos", async () => {
    expect((await render({ numPhotosetItems: 1, numPhotos: 3 })).textContent).toContain("1 day, 3 photos");
  });

  it("counts videos as videos", async () => {
    expect((await render({ numPhotosetItems: 2, numPhotos: 4, countsVideos: true })).textContent).toContain(
      "2 days, 4 videos"
    );
  });

  it("leaves out the days when every item is its own group", async () => {
    const text = (await render({ numPhotosetItems: 5, numPhotos: 5 })).textContent;
    expect(text).toContain("5 photos");
    expect(text).not.toContain("day");
  });

  it("groups the digits of large counts", async () => {
    expect((await render({ numPhotosetItems: 1200, numPhotos: 25123 })).textContent).toContain(
      "1,200 days, 25,123 photos"
    );
  });
});

describe("DefaultHeader view switcher", () => {
  it("opens from a button inside the heading, so the keyboard can reach it", async () => {
    const el = await render({});
    const heading = defined(el.querySelector("h1"));
    const button = heading.querySelector("button");

    expect(button).not.toBeNull();
    expect(defined(button).getAttribute("aria-haspopup")).toBe("menu");
    expect(heading.textContent).toContain("Photos");
  });

  it("lists Not in an album right after Without Location and marks it on /noalbum", async () => {
    route.pathname = "/noalbum";
    const el = await render({ title: "Photos not in an album" });
    await act(async () => defined(el.querySelector<HTMLButtonElement>("h1 button")).click());

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const labels = items.map(item => item.textContent);
    expect(labels.indexOf("Not in an album")).toBe(labels.indexOf("Without Location") + 1);
    const current = items.filter(item => item.querySelector(".tabler-icon-check"));
    expect(current.map(item => item.textContent)).toEqual(["Not in an album"]);
  });
});

describe("DefaultHeader on an empty timeline", () => {
  it("welcomes an admin without a scan directory instead of showing the header", async () => {
    route.isAdmin = true;
    route.scanDirectory = "";
    const el = await render({ numPhotosetItems: 0, numPhotos: 0 });

    expect(el.textContent).toContain(i18n.t("defaultheader.gettingstarted"));
    expect(el.querySelector("h1")).toBeNull();
  });

  it("keeps the header for a user who is not an admin", async () => {
    route.scanDirectory = "";
    const el = await render({ numPhotosetItems: 0, numPhotos: 0 });

    expect(el.textContent).not.toContain(i18n.t("defaultheader.gettingstarted"));
    expect(el.querySelector("h1")).not.toBeNull();
  });
});

describe("DefaultHeader date", () => {
  it("shows the day of a one-day list beside the title", async () => {
    const el = await render({ date: "2026-10-13T10:00:00Z", dayHeaderPrefix: "Added on " });

    expect(el.textContent).toContain("Added on ");
    expect(el.textContent).toContain("2026");
  });

  it("shows a date it cannot read as it came", async () => {
    const el = await render({ date: "someday" });

    expect(el.textContent).toContain("someday");
  });
});

describe("DefaultHeader title badge", () => {
  it("sits after the title, inside the heading", async () => {
    route.pathname = "/album/user/7";
    const el = await render({ title: "Lisbon 2026", titleBadge: <span data-testid="badge">Locked</span> });

    expect(defined(el.querySelector("h1")).textContent).toBe("Lisbon 2026Locked");
    expect(el.querySelector('h1 [data-testid="badge"]')).not.toBeNull();
  });
});
