/**
 * Renaming a person from the faces dashboard. The input starts empty (the old
 * name is only the placeholder), and the backend rejects a blank name with a 400
 * nothing reports, so Rename must stay disabled until there is a name, and the
 * name is sent trimmed. The dialog is a form, so Enter renames as well.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import { HeaderComponent } from "./HeaderComponent";

type RenameParams = { id: string; personName: string; newPersonName: string };
type HeaderProps = React.ComponentProps<typeof HeaderComponent>;

const stubs = vi.hoisted(() => ({ rename: vi.fn<(params: RenameParams) => void>() }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "labeled" }) }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useRenamePersonAlbumMutation: () => ({ mutate: stubs.rename }),
  useDeletePersonAlbumMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useFetchPeopleAlbumsQuery: () => ({ data: [{ name: "Sofia" }, { name: "Miguel" }] }),
}));
vi.mock("../../api_client/faces/hooks", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

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
  // The modal needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
}, 60000);

beforeEach(async () => {
  stubs.rename.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const cell: CompletePersonFace = {
    id: 7,
    name: "Sofia",
    kind: "USER",
    face_count: 1,
    faces: [{ id: 1, image: "/f.jpg", face_url: "/f.jpg", photo: "p1", person_label_probability: 1, isTemp: false }],
  };
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the menu and dialog render in place
      <MantineProvider env="test">
        <HeaderComponent
          cell={cell}
          style={{}}
          selectedFaces={[]}
          setSelectedFaces={vi.fn<HeaderProps["setSelectedFaces"]>()}
          isCollapsed={false}
          onToggleCollapse={vi.fn<() => void>()}
        />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The element a test goes on to use: missing, the test fails here and says what was missing. */
function rendered<T>(element: T | null | undefined, what: string): T {
  if (element === null || element === undefined) throw new Error(`${what} is not rendered`);
  return element;
}

const button = (label: string) =>
  rendered(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label),
    `the ${label} button`
  );
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

const menuTrigger = () =>
  rendered(container.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]"), "the menu button");

async function openRename() {
  await click(menuTrigger());
  await click(button("Rename"));
}

async function type(value: string) {
  const input = rendered(container.querySelector<HTMLInputElement>("input[placeholder]"), "the name input");
  const setValue = rendered(
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set,
    "value's setter"
  );
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const renameButton = () =>
  rendered(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button[type=submit]")).find(
      el => el.textContent === "Rename"
    ),
    "the Rename submit button"
  );
const form = () => rendered(container.querySelector<HTMLFormElement>("form"), "the rename form");

describe("renaming a person", () => {
  it("does not offer to rename to an empty name", async () => {
    await openRename();
    expect(renameButton().disabled).toBe(true);

    await type("   ");
    expect(renameButton().disabled).toBe(true);
  });

  it("does not offer a name another person has", async () => {
    await openRename();
    await type(" miguel ");

    expect(renameButton().disabled).toBe(true);
    expect(container.textContent).toContain("Person miguel already exists.");
  });

  it("renames to the trimmed name", async () => {
    await openRename();
    await type("  Sofia Maria ");
    await click(renameButton());

    expect(stubs.rename).toHaveBeenCalledWith({ id: "7", personName: "Sofia", newPersonName: "Sofia Maria" });
  });

  it("renames on Enter", async () => {
    await openRename();
    await type("Sofia Maria");
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.rename).toHaveBeenCalledWith({ id: "7", personName: "Sofia", newPersonName: "Sofia Maria" });
  });

  it("does not submit a blank name on Enter", async () => {
    await openRename();
    await type("  ");
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.rename).not.toHaveBeenCalled();
  });
});

// The menu item focus would go back to is gone by then, which left focus on the page body
describe("closing the dialogs", () => {
  it("puts focus back on the menu button after Cancel", async () => {
    await openRename();
    await click(button("Cancel"));

    expect(document.activeElement).toBe(menuTrigger());
  });

  it("puts focus back on the menu button after renaming", async () => {
    await openRename();
    await type("Sofia Maria");
    await click(renameButton());

    expect(document.activeElement).toBe(menuTrigger());
  });

  it("puts focus back on the menu button after deleting", async () => {
    await click(menuTrigger());
    await click(button("Delete"));
    // The menu has closed: this is the dialog's button
    await click(button("Delete"));

    expect(document.activeElement).toBe(menuTrigger());
  });
});
