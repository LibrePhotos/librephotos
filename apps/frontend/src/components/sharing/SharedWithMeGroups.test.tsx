/**
 * Sharing > Shared with you > Places, Things and People (#2721, #2722): each tile links to the
 * photos shared with you under it, a person names whose they are ("Mom, shared by Alice"), and an
 * empty list says why rather than showing an empty grid.
 */
import type { SharedGroup, SharedPerson } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PeopleSharedWithMe } from "./PeopleSharedWithMe";
import { SharedGroupsWithMe } from "./SharedGroupsWithMe";

type Params = Record<string, string>;

const stubs = vi.hoisted(() => ({
  groups: [] as SharedGroup[],
  people: [] as SharedPerson[],
}));

vi.mock("@tanstack/react-router", async () => {
  const { forwardRef, createElement } = await import("react");
  const fill = (to: string, params: Params) =>
    Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, encodeURIComponent(value)), to);
  return {
    Link: forwardRef<HTMLAnchorElement, { to: string; params: Params; children?: React.ReactNode }>(
      ({ to, params, ...rest }, ref) => createElement("a", { ref, href: fill(to, params), ...rest })
    ),
    useElementScrollRestoration: () => undefined,
  };
});
vi.mock("@mantine/hooks", async importOriginal => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useElementSize: () => ({ ref: () => {}, width: 1200, height: 0 }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchSharedGroupsWithMeQuery: () => ({ data: stubs.groups, isLoading: false, isError: false }),
  useFetchSharedPeopleWithMeQuery: () => ({ data: stubs.people, isLoading: false, isError: false }),
}));
vi.mock("../common/useListFailure", () => ({ useListFailure: () => undefined }));

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
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(<MantineProvider env="test">{element}</MantineProvider>));
}

const alice = { id: 2, username: "alice", first_name: "Alice", last_name: "Lang" };

describe("the places and things shared with you", () => {
  it("links each place to its shared photos, with their count", async () => {
    stubs.groups = [
      { title: "Lisbon", photo_count: 23, cover_photos: [{ image_hash: "h1", video: false }] },
      { title: "São Paulo", photo_count: 1, cover_photos: [] },
    ];
    await render(<SharedGroupsWithMe kind="places" />);

    expect(container.querySelector("a[aria-label='Lisbon']")?.getAttribute("href")).toBe(
      "/sharing/withme/places/Lisbon"
    );
    expect(container.querySelector("a[aria-label='São Paulo']")?.getAttribute("href")).toBe(
      "/sharing/withme/places/S%C3%A3o%20Paulo"
    );
    expect(container.textContent).toContain("23 Photos");
  });

  it("links things to the things page", async () => {
    stubs.groups = [{ title: "tram", photo_count: 2, cover_photos: [] }];
    await render(<SharedGroupsWithMe kind="things" />);

    expect(container.querySelector("a[href='/sharing/withme/things/tram']")).not.toBeNull();
  });

  it("says so when the shared photos have no place", async () => {
    stubs.groups = [];
    await render(<SharedGroupsWithMe kind="places" />);

    expect(container.textContent).toContain("None of the photos shared with you has a place yet.");
  });
});

describe("the people shared with you", () => {
  it("names each person with whose they are", async () => {
    stubs.people = [
      { id: 7, name: "Mom", owner: alice, photo_count: 1, face_url: null },
      {
        id: 9,
        name: "Mom",
        owner: { ...alice, id: 3, first_name: "", last_name: "", username: "jonas" },
        photo_count: 4,
        face_url: "/media/faces/9.jpg",
      },
    ];
    await render(<PeopleSharedWithMe />);

    const faces = Array.from(container.querySelectorAll("img"), img => img.getAttribute("alt"));
    expect(faces).toEqual(["Mom, shared by Alice Lang", "Mom, shared by jonas"]);
    expect(container.textContent).toContain("shared by Alice Lang1 Photo");
    expect(container.textContent).toContain("shared by jonas4 Photos");
    expect(container.querySelector("a[href='/sharing/withme/people/9']")).not.toBeNull();
  });

  it("says why nobody is listed", async () => {
    stubs.people = [];
    await render(<PeopleSharedWithMe />);

    expect(container.textContent).toContain("Nobody on the photos shared with you has a name you can see yet.");
    expect(container.textContent).toContain("if they share people's names");
  });
});
