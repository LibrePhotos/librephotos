/**
 * The "New person" field of the face labelling dialog. A blank name or one a person already has
 * (trimmed, any case) cannot be added, and the clash is reported; a new name is applied trimmed,
 * to the selected faces or to the caller's own handler, and the dialog closes. The field is also
 * the filter of the person list below it.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ModalPersonEdit } from "./ModalPersonEdit";

const stubs = vi.hoisted(() => ({
  people: [
    { id: "1", name: "Alice", video: false, face_count: 12, face_photo_url: "/alice", face_url: "/alice" },
    { id: "2", name: "Bob", video: false, face_count: 8, face_photo_url: "/bob", face_url: "/bob" },
  ],
  setFacesPersonLabel: vi.fn<ReturnType<typeof useSetFacesPersonLabelMutation>["mutate"]>(),
  close: vi.fn<() => void>(),
  resetGroups: vi.fn<() => void>(),
  chosen: vi.fn<(personName: string) => void>(),
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({ useFetchPeopleAlbumsQuery: () => ({ data: stubs.people }) }));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setFacesPersonLabel }),
}));

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
  // jsdom has no ResizeObserver, the modal's ScrollArea needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderModal(props: Partial<React.ComponentProps<typeof ModalPersonEdit>> = {}) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <ModalPersonEdit
          isOpen
          onRequestClose={stubs.close}
          resetGroups={stubs.resetGroups}
          selectedFaces={[{ face_id: 42, face_url: "/face42" }]}
          {...props}
        />
      </MantineProvider>
    );
  });
}

const nameInput = () => defined(container.querySelector<HTMLInputElement>("input"), "the name input");
const addButton = () =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === "Add Person"),
    "the Add person button"
  );
const listedPeople = () => Array.from(container.querySelectorAll("h4"), title => title.textContent);
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  await act(async () => {
    setInputValue?.call(nameInput(), value);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ModalPersonEdit new person", () => {
  it("does not offer to add a blank name", async () => {
    await renderModal();
    expect(addButton().disabled).toBe(true);

    await type("   ");
    expect(addButton().disabled).toBe(true);
  });

  it("refuses a name a person already has, trimmed and in any case", async () => {
    await renderModal();
    await type(" alice ");

    expect(container.textContent).toContain("Person alice already exists.");
    expect(addButton().disabled).toBe(true);
  });

  it("labels the selected faces with the trimmed new name and closes", async () => {
    await renderModal();
    await type("  Carol ");
    await act(async () => addButton().click());

    expect(stubs.setFacesPersonLabel).toHaveBeenCalledWith({ faceIds: [42], personName: "Carol" });
    expect(stubs.resetGroups).toHaveBeenCalledTimes(1);
    expect(stubs.close).toHaveBeenCalledTimes(1);
    expect(nameInput().value).toBe("");
  });

  it("hands the new name to the caller's handler instead", async () => {
    await renderModal({ onPersonChosen: stubs.chosen });
    await type(" Carol");
    await act(async () => addButton().click());

    expect(stubs.chosen).toHaveBeenCalledWith("Carol");
    expect(stubs.setFacesPersonLabel).not.toHaveBeenCalled();
  });

  it("filters the person list by the typed name", async () => {
    await renderModal();
    expect(listedPeople()).toEqual(["Alice", "Bob"]);

    await type("bo");
    expect(listedPeople()).toEqual(["Bob"]);
    expect(container.textContent).not.toContain("already exists");
  });

  it("forgets the typed name when closed", async () => {
    await renderModal();
    await type("Carol");
    const close = defined(container.querySelector<HTMLButtonElement>(".mantine-Modal-close"), "the close button");
    await act(async () => close.click());

    expect(stubs.close).toHaveBeenCalledTimes(1);
    expect(nameInput().value).toBe("");
  });
});
