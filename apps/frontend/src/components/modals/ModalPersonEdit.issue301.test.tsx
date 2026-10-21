/**
 * Typing a name in the face labelling dialog lists the matches with the most faces first, so the
 * person being looked for is not buried under rarely seen namesakes (#301). Without a name the
 * list keeps the server's name order.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ModalPersonEdit } from "./ModalPersonEdit";

const person = (id: string, name: string, face_count: number) => ({
  id,
  name,
  video: false,
  face_count,
  face_photo_url: `/${id}`,
  face_url: `/${id}`,
});

// In the name order the server sends them.
const stubs = {
  people: [person("1", "Anna", 2), person("2", "Annabel", 30), person("3", "Annie", 9), person("4", "Bob", 50)],
};

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({ useFetchPeopleAlbumsQuery: () => ({ data: stubs.people }) }));
vi.mock("../../api_client/faces", () => ({ useSetFacesPersonLabelMutation: () => ({ mutate: () => {} }) }));

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
});

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <ModalPersonEdit isOpen onRequestClose={() => {}} selectedFaces={[{ face_id: 1, face_url: "/face1" }]} />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const listedPeople = () => Array.from(container.querySelectorAll("h4"), title => title.textContent);
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  const input = defined(container.querySelector<HTMLInputElement>("input"), "the name input");
  await act(async () => {
    setInputValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ModalPersonEdit people order (#301)", () => {
  it("keeps the name order while no name is typed", () => {
    expect(listedPeople()).toEqual(["Anna", "Annabel", "Annie", "Bob"]);
  });

  it("puts the matches with the most faces first once a name is typed", async () => {
    await type("ann");

    expect(listedPeople()).toEqual(["Annabel", "Annie", "Anna"]);
  });

  it("keeps the name order among matches with the same number of faces", async () => {
    stubs.people = [person("1", "Zoe", 5), person("2", "Zed", 5), person("3", "Zack", 5)];
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <ModalPersonEdit isOpen onRequestClose={() => {}} selectedFaces={[{ face_id: 1, face_url: "/face1" }]} />
        </MantineProvider>
      );
    });
    await type("z");

    expect(listedPeople()).toEqual(["Zoe", "Zed", "Zack"]);
  });
});
