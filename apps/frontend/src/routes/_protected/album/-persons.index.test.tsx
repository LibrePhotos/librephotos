/**
 * The People page's groups (#1126): the group menu button narrows the people to one group (kept in
 * `?group=`), the subtitle counts the people shown, an empty group says so, and a person's ⋮ opens
 * the "Groups…" checklist. Each person is a round crop of their cover face (#2241), with the whole
 * photo or the placeholder when there is none.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { PersonGroup } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../../../api_client/albums/hooks";
import i18n from "../../../i18n";
import { defined } from "../../../util/defined.test-utils";

type Navigate = (options: { to?: string; search?: Record<string, unknown> }) => Promise<void>;

const person = (id: string, name: string, groupIds: number[]): Person => ({
  id,
  name,
  video: false,
  face_count: 2,
  face_photo_url: "hash",
  face_url: "",
  group_ids: groupIds,
});

const GROUPS: PersonGroup[] = [
  { id: 3, name: "Family", person_count: 1 },
  { id: 4, name: "Work", person_count: 0 },
];

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  search: {} as { group?: number },
  people: [] as Person[],
  navigate: vi.fn<Navigate>(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component?: React.ComponentType }) => {
    stubs.component = options.component;
    return { useSearch: () => stubs.search, useNavigate: () => stubs.navigate };
  },
  Link: ({ children, params }: { children: React.ReactNode; params: { id: string } }) => (
    <a href={`#person-${params.id}`}>{children}</a>
  ),
  useNavigate: () => stubs.navigate,
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: () => ({
    data: stubs.people,
    isFetching: false,
    isLoading: false,
    isError: false,
    refetch: async () => undefined,
  }),
  useRenamePersonAlbumMutation: () => ({ mutate: () => {} }),
  useDeletePersonAlbumMutation: () => ({ mutate: () => {} }),
  useFetchPersonGroupsQuery: () => ({ data: GROUPS, isLoading: false }),
  useSetPersonGroupsMutation: () => ({ mutate: () => {} }),
  useCreatePersonGroupMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }),
  useRenamePersonGroupMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }),
  useDeletePersonGroupMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../../components/Tile", () => ({
  Tile: ({ image_hash, alt }: { image_hash: string; alt?: string }) => <img data-tile={image_hash} alt={alt} />,
}));
// The grid's virtualisation needs a layout jsdom lacks: every person in a plain list.
vi.mock("../../../components/virtual/TileGrid", () => ({
  TileGrid: ({
    items,
    renderItem,
    renderCaption,
  }: {
    items: Person[];
    renderItem: (item: Person, size: number) => React.ReactNode;
    renderCaption: (item: Person) => React.ReactNode;
  }) => (
    <ul>
      {items.map(item => (
        <li key={item.id} data-testid="person">
          {renderItem(item, 100)}
          {renderCaption(item)}
        </li>
      ))}
    </ul>
  ),
}));

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
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./persons.index");
}, 30_000);

let root: Root | undefined;

beforeEach(() => {
  stubs.search = {};
  stubs.people = [person("1", "Anna", [3]), person("2", "Ben", [])];
  stubs.navigate.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function render() {
  const Page = defined(stubs.component, "the People page");
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <Page />
      </MantineProvider>
    )
  );
}

const shownNames = () => Array.from(document.body.querySelectorAll('[data-testid="person"]')).map(el => el.textContent);

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

describe("the People page's groups", () => {
  it("shows everybody with the group button", async () => {
    await render();

    expect(shownNames()).toEqual([expect.stringContaining("Anna"), expect.stringContaining("Ben")]);
    expect(document.body.textContent).toContain("2 people");
    expect(button("Group: All people")).toBeDefined();
  });

  it("narrows to the group in the URL and counts the people in it", async () => {
    stubs.search = { group: 3 };
    await render();

    expect(shownNames()).toEqual([expect.stringContaining("Anna")]);
    expect(document.body.textContent).toContain("1 person in Family");
  });

  it("keeps the picked group in the URL", async () => {
    await render();
    await act(async () => button("Group: All people").click());
    const work = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el =>
      el.textContent?.startsWith("Work")
    );
    await act(async () => defined(work, "Work").click());

    expect(stubs.navigate).toHaveBeenCalledWith({ search: { group: 4 } });
  });

  it("says when nobody is in the group, and offers everybody", async () => {
    stubs.search = { group: 4 };
    await render();

    expect(shownNames()).toEqual([]);
    expect(document.body.textContent).toContain("Nobody in this group yet");
    await act(async () => button("All people").click());
    expect(stubs.navigate).toHaveBeenCalledWith({ search: {} });
  });

  it("opens a person's groups from the tile menu", async () => {
    await render();
    await act(async () =>
      defined(document.body.querySelectorAll<HTMLButtonElement>('[aria-label="More actions"]')[0]).click()
    );
    const groups = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      el => el.textContent === "Groups…"
    );
    await act(async () => defined(groups, "Groups…").click());

    expect(document.body.textContent).toContain("Groups for Anna");
    const family = defined(document.body.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    expect(family.checked).toBe(true);
  });
});

/** The cell of the person called `name`, by the caption under their picture. */
function cellOf(name: string): HTMLElement {
  const cells = Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="person"]'));
  return defined(
    cells.find(cell => cell.querySelector("[title]")?.getAttribute("title") === name),
    `the cell of ${name}`
  );
}

/** A link's accessible name when it holds only pictures: their alt texts. */
function linkName(link: HTMLAnchorElement): string {
  return (
    link.getAttribute("aria-label") ??
    Array.from(link.querySelectorAll("img"))
      .map(img => img.alt)
      .join(" ")
  );
}

describe("the People page's pictures (#2241)", () => {
  it("shows the cover face crop when there is one", async () => {
    stubs.people = [{ ...person("1", "Anna", []), face_url: "/media/faces/anna_0_x.jpg" }];
    await render();

    const img = defined(cellOf("Anna").querySelector("img"), "Anna's picture");
    expect(img.getAttribute("src")).toMatch(/\/media\/faces\/anna_0_x\.jpg$/);
    expect(img.hasAttribute("data-tile")).toBe(false);
  });

  it("falls back to the whole cover photo without a face crop", async () => {
    stubs.people = [person("1", "Anna", [])];
    await render();

    const img = defined(cellOf("Anna").querySelector("img"), "Anna's picture");
    expect(img.getAttribute("data-tile")).toBe("hash");
  });

  it("shows the placeholder without either, for someone with no faces and for the legacy unknown", async () => {
    stubs.people = [
      { ...person("1", "Anna", []), face_photo_url: "" },
      { ...person("2", "Ben", []), face_count: 0, face_url: "/media/faces/ben.jpg" },
      { ...person("3", "unknown", []), face_url: "/media/faces/someone.jpg" },
    ];
    await render();

    expect(cellOf("Anna").querySelector("img")?.getAttribute("src")).toBe("/unknown_user.jpg");
    expect(cellOf("Ben").querySelector("img")?.getAttribute("src")).toBe("/unknown_user.jpg");
    expect(cellOf("unknown").querySelector("a img")?.getAttribute("src")).toBe("/unknown_user.jpg");
    // Nobody to open: Ben's picture is not a link
    expect(cellOf("Ben").querySelector("a")).toBeNull();
  });

  it("names each person's link after the person", async () => {
    stubs.people = [{ ...person("1", "Anna", []), face_url: "/media/faces/anna.jpg" }, person("2", "Ben", [])];
    await render();

    const links = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('[data-testid="person"] a'));
    expect(links.map(linkName)).toEqual(["Anna", "Ben"]);
  });
});
