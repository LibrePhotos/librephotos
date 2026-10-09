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
import i18n from "../../i18n";
import { HeaderComponent } from "./HeaderComponent";

const stubs = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "labeled" }) }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useRenamePersonAlbumMutation: () => ({ mutate: stubs.rename }),
  useDeletePersonAlbumMutation: () => ({ mutate: vi.fn() }),
  useFetchPeopleAlbumsQuery: () => ({ data: [{ name: "Sofia" }, { name: "Miguel" }] }),
}));
vi.mock("../../api_client/faces/hooks", () => ({ useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn() }) }));

let root: ReturnType<typeof createRoot>;
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
  // @ts-ignore - the modal needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
}, 60000);

beforeEach(async () => {
  stubs.rename.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const cell = { id: "7", name: "Sofia", kind: "USER", faces: [{ id: 1, face_url: "/f.jpg", isTemp: false }] };
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the menu and dialog render in place
      <MantineProvider env="test">
        <HeaderComponent
          cell={cell}
          style={{}}
          selectedFaces={[]}
          setSelectedFaces={vi.fn()}
          isCollapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label)!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

const menuTrigger = () => container.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!;

async function openRename() {
  await click(menuTrigger());
  await click(button("Rename"));
}

async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>("input[placeholder]")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const renameButton = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button[type=submit]")).find(
    el => el.textContent === "Rename"
  )!;

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
    const form = container.querySelector<HTMLFormElement>("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.rename).toHaveBeenCalledWith({ id: "7", personName: "Sofia", newPersonName: "Sofia Maria" });
  });

  it("does not submit a blank name on Enter", async () => {
    await openRename();
    await type("  ");
    const form = container.querySelector<HTMLFormElement>("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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
