/**
 * Renaming a person from the people page. The backend refuses a blank name and nothing would
 * report it, so Rename stays disabled for one; a name another person has (trimmed, any case) is
 * refused with an error; the new name is handed back trimmed; Enter renames too; and every
 * opening starts with an empty name.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonRenameModal } from "./PersonRenameModal";

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));

const person = { id: "7", name: "Sofia", video: false, face_count: 3, face_photo_url: "/f", face_url: "/f" };
const onClose = vi.fn<() => void>();
const onSubmit = vi.fn<(newName: string) => void>();

let root: Root;
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDialog(opened: boolean) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <PersonRenameModal
          opened={opened}
          onClose={onClose}
          person={person}
          existingNames={["Sofia", " Miguel "]}
          onSubmit={onSubmit}
        />
      </MantineProvider>
    );
  });
}

const input = () => defined(container.querySelector<HTMLInputElement>("input"), "the name input");
const renameButton = () =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === "Rename"),
    "the Rename button"
  );
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  await act(async () => {
    setInputValue?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter() {
  const form = defined(container.querySelector("form"), "the rename form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("PersonRenameModal", () => {
  it("does not offer to rename to an empty name", async () => {
    await renderDialog(true);
    expect(renameButton().disabled).toBe(true);

    await type("   ");
    expect(renameButton().disabled).toBe(true);
    await pressEnter();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a name another person has, trimmed and in any case", async () => {
    await renderDialog(true);
    await type(" miguel ");

    expect(container.textContent).toContain("Person miguel already exists.");
    expect(renameButton().disabled).toBe(true);
    await pressEnter();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hands back the trimmed name and closes", async () => {
    await renderDialog(true);
    await type("  Sofia Maria ");
    await act(async () => renameButton().click());

    expect(onSubmit).toHaveBeenCalledWith("Sofia Maria");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renames on Enter", async () => {
    await renderDialog(true);
    await type("Sofia Maria");
    await pressEnter();

    expect(onSubmit).toHaveBeenCalledWith("Sofia Maria");
  });

  it("starts empty every time it is opened", async () => {
    await renderDialog(true);
    await type("Miguel");

    await renderDialog(false);
    await renderDialog(true);

    expect(input().value).toBe("");
    expect(container.textContent).not.toContain("already exists");
    expect(renameButton().disabled).toBe(true);
  });
});
