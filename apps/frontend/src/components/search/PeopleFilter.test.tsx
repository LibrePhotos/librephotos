/**
 * The people picker of the search filter panel lists the matches of a typed name with the most
 * faces first (#301); without a search it keeps name order.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PeopleFilter } from "./PeopleFilter";

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));

const person = (id: string, name: string, face_count: number): Person => ({
  id,
  name,
  video: false,
  face_count,
  face_photo_url: "",
  face_url: "",
  group_ids: [],
});

// In the name order the server sends them.
const people = [person("1", "Anna", 2), person("2", "Annabel", 30), person("3", "Annie", 9), person("4", "Bob", 50)];

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <span id="label">People</span>
        <PeopleFilter people={people} value={undefined} onChange={() => {}} labelId="label" />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const searchInput = () => defined(container.querySelector<HTMLInputElement>("input"), "the search input");
const listedPeople = () =>
  Array.from(container.querySelectorAll('[role="option"]'), option => option.textContent?.replace(/\d+ faces?$/, ""));
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  await act(async () => {
    searchInput().focus();
    setInputValue?.call(searchInput(), value);
    searchInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PeopleFilter people order (#301)", () => {
  it("keeps the name order without a search", async () => {
    await type(" ");

    expect(listedPeople()).toEqual(["Anna", "Annabel", "Annie", "Bob"]);
  });

  it("puts the matches with the most faces first once a name is typed", async () => {
    await type("ann");

    expect(listedPeople()).toEqual(["Annabel", "Annie", "Anna"]);
  });
});
