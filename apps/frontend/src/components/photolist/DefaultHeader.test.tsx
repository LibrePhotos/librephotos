/**
 * The grid header's counter glued a number to a fixed plural ("1 days",
 * "1 photos", and "4 photos" on the Videos page), and the title's view
 * switcher was an h2 that could only be opened with a mouse.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { DefaultHeader } from "./DefaultHeader";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useRouter: () => ({ state: { location: { pathname: route.pathname } } }),
}));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1, is_admin: false, name: "admin" } } }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserSelfDetailsQuery: () => ({ data: { scan_directory: "/data" } }),
  useFetchUserListQuery: () => ({ data: [] }),
}));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Partial<React.ComponentProps<typeof DefaultHeader>>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    defined(root).render(
      <MantineProvider>
        <DefaultHeader
          loading={false}
          numPhotosetItems={1}
          numPhotos={1}
          icon={<span />}
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
});

describe("DefaultHeader view switcher", () => {
  it("opens from a button inside the heading, so the keyboard can reach it", async () => {
    const el = await render({});
    const heading = defined(el.querySelector("h2"));
    const button = heading.querySelector("button");

    expect(button).not.toBeNull();
    expect(defined(button).getAttribute("aria-haspopup")).toBe("menu");
    expect(heading.textContent).toContain("Photos");
  });
});
