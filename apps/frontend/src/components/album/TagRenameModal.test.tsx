/**
 * The rename-tag dialog: a name another tag already has (ignoring case and
 * spaces) is refused with an error and cannot be submitted, a new name is
 * handed back trimmed, and a reopened dialog starts empty again.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TagRenameModal } from "./TagRenameModal";

const existingNames = ["Beach", "Holiday"];

let root: Root;
const onClose = vi.fn<() => void>();
const onSubmit = vi.fn<(newName: string) => void>();

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
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function renderDialog(opened: boolean) {
  act(() => {
    root.render(
      <MantineProvider>
        <TagRenameModal
          opened={opened}
          onClose={onClose}
          tagName="Sunset"
          existingNames={existingNames}
          onSubmit={onSubmit}
        />
      </MantineProvider>
    );
  });
}

/** React tracks the previous value on the node itself, so plain assignment is swallowed. */
function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>(".mantine-Modal-body input");
  if (!input) throw new Error("the name input is not rendered");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>(".mantine-Modal-body button")).find(
    element => element.textContent === label
  );
  if (!found) throw new Error(`no ${label} button in the dialog`);
  return found;
}

describe("TagRenameModal", () => {
  it("refuses a name another tag already has, ignoring case and spaces", () => {
    renderDialog(true);
    typeName("  beach ");

    expect(document.body.textContent).toContain(i18n.t("tagalbum.tagalreadyexists", { name: "beach" }));
    expect(button(i18n.t("rename")).disabled).toBe(true);
  });

  it("submits a new name trimmed and closes", () => {
    renderDialog(true);
    typeName("  Mountains  ");

    expect(button(i18n.t("rename")).disabled).toBe(false);
    act(() => button(i18n.t("rename")).click());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Mountains");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels without submitting", () => {
    renderDialog(true);
    typeName("Mountains");
    act(() => button(i18n.t("cancel")).click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts empty every time it is opened", () => {
    renderDialog(true);
    typeName("Mountains");

    renderDialog(false);
    renderDialog(true);

    const input = document.querySelector<HTMLInputElement>(".mantine-Modal-body input");
    expect(input?.value).toBe("");
    expect(button(i18n.t("rename")).disabled).toBe(true);
  });
});
