/**
 * The group filter of People and the face dashboard (#1126): a menu button that names the current
 * group, an item per group with its person count and a check on the current one, a compact icon on
 * a phone, and "Manage groups…", which renames, deletes (after asking) and adds groups.
 */
import type { PersonGroup } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  useCreatePersonGroupMutation,
  useDeletePersonGroupMutation,
  useRenamePersonGroupMutation,
} from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonGroupFilter } from "./PersonGroupFilter";

type Create = ReturnType<typeof useCreatePersonGroupMutation>["mutateAsync"];
type Rename = ReturnType<typeof useRenamePersonGroupMutation>["mutateAsync"];
type Remove = ReturnType<typeof useDeletePersonGroupMutation>["mutate"];

const GROUPS: PersonGroup[] = [
  { id: 3, name: "Family", person_count: 4 },
  { id: 4, name: "Work", person_count: 1 },
];

const stubs = vi.hoisted(() => ({
  phone: false,
  groups: [] as PersonGroup[],
  create: vi.fn<Create>(),
  rename: vi.fn<Rename>(),
  remove: vi.fn<Remove>(),
  onChange: vi.fn<(group: number | undefined) => void>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPersonGroupsQuery: () => ({ data: stubs.groups, isLoading: false }),
  useCreatePersonGroupMutation: () => ({ mutateAsync: stubs.create, isPending: false }),
  useRenamePersonGroupMutation: () => ({ mutateAsync: stubs.rename, isPending: false }),
  useDeletePersonGroupMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));

beforeAll(async () => {
  // jsdom has no matchMedia; the phone layout answers the small-screen query
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: stubs.phone && query.includes("max-width"),
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
});

let root: Root | undefined;

beforeEach(() => {
  stubs.phone = false;
  stubs.groups = GROUPS;
  stubs.create.mockReset();
  stubs.rename.mockReset();
  stubs.remove.mockReset();
  stubs.onChange.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function render(value: number | undefined) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <PersonGroupFilter groups={GROUPS} value={value} onChange={stubs.onChange} />
      </MantineProvider>
    )
  );
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const item = (label: string) =>
  defined(
    menuItems().find(el => el.textContent?.startsWith(label)),
    label
  );
const isChecked = (el: Element) => el.querySelector(".tabler-icon-check") !== null;

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PersonGroupFilter", () => {
  it("shows everybody until a group is picked, and lists the groups with their counts", async () => {
    await render(undefined);
    await act(async () => button("Group: All people").click());

    expect(menuItems().map(el => el.textContent)).toEqual(["All people", "Family4", "Work1", "Manage groups…"]);
    expect(isChecked(item("All people"))).toBe(true);
    await act(async () => item("Work").click());
    expect(stubs.onChange).toHaveBeenCalledWith(4);
  });

  it("names the current group and goes back to everybody", async () => {
    await render(3);
    expect(button("Group: Family").textContent).toBe("Family");
    await act(async () => button("Group: Family").click());

    expect(isChecked(item("Family"))).toBe(true);
    await act(async () => item("All people").click());
    expect(stubs.onChange).toHaveBeenCalledWith(undefined);
  });

  it("is an icon on a phone, still named after the group", async () => {
    stubs.phone = true;
    await render(4);
    expect(button("Group: Work").textContent).toBe("");
  });

  it("manages the groups: rename in place, delete after asking, add a new one", async () => {
    await render(undefined);
    await act(async () => button("Group: All people").click());
    await act(async () => item("Manage groups…").click());

    const dialog = () => defined(document.body.querySelector('[role="dialog"]'), "the dialog");
    expect(dialog().textContent).toContain("4 people");
    expect(dialog().textContent).toContain("1 person");

    // Rename refuses a name another group has, in any case
    stubs.rename.mockResolvedValue({ id: 3, name: "Kin", person_count: 4 });
    await act(async () => button("Rename Family").click());
    const field = defined(document.body.querySelector<HTMLInputElement>('input[aria-label="Rename Family"]'));
    await typeInto(field, "work");
    await act(async () => field.closest("form")?.requestSubmit());
    expect(document.body.textContent).toContain("Group work already exists.");
    expect(stubs.rename).not.toHaveBeenCalled();
    await typeInto(field, "Kin");
    await act(async () => field.closest("form")?.requestSubmit());
    expect(stubs.rename).toHaveBeenCalledWith({ id: 3, name: "Family", newName: "Kin" });

    stubs.create.mockResolvedValue({ id: 5, name: "Club", person_count: 0 });
    const newGroup = defined(document.body.querySelector<HTMLInputElement>('input[aria-label="New group"]'));
    await typeInto(newGroup, " Club ");
    await act(async () => newGroup.closest("form")?.requestSubmit());
    expect(stubs.create).toHaveBeenCalledWith("Club");

    await act(async () => button("Delete Work").click());
    expect(document.body.textContent).toContain("Delete the group Work?");
    await act(async () => button("Delete group").click());
    expect(stubs.remove).toHaveBeenCalledWith({ id: 4, name: "Work" }, expect.anything());
  });

  it("says when there are no groups yet", async () => {
    stubs.groups = [];
    await render(undefined);
    await act(async () => button("Group: All people").click());
    await act(async () => item("Manage groups…").click());

    expect(document.body.textContent).toContain("No groups yet.");
  });
});
