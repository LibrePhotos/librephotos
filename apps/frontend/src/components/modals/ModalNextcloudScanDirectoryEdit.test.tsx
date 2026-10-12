/**
 * The Nextcloud scan directory dialog starts from the saved folder each time it opens; a folder
 * is typed or picked from the tree; Update hands it back trimmed and closes, and stays disabled
 * while the folder is blank or the saved one.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ModalNextcloudScanDirectoryEdit } from "./ModalNextcloudScanDirectoryEdit";

// One array, as React Query hands back the same data on every render
const stubs = vi.hoisted(() => ({ dirs: [{ title: "Photos", absolute_path: "/Photos", children: [] }] }));

vi.mock("../../api_client/folders/hooks/useFetchNextcloudDirsQuery", () => ({
  useFetchNextcloudDirsQuery: () => ({ data: stubs.dirs }),
}));

const onChange = vi.fn<(dir: string) => void>();
const onClose = vi.fn<() => void>();

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

async function renderDialog(isOpen: boolean, path: string | null = "/Saved") {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <ModalNextcloudScanDirectoryEdit path={path} isOpen={isOpen} onChange={onChange} onClose={onClose} />
      </MantineProvider>
    );
  });
}

const input = () => defined(container.querySelector<HTMLInputElement>("input"), "the directory input");
const button = (label: string) =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label),
    `the ${label} button`
  );
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  await act(async () => {
    setInputValue?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ModalNextcloudScanDirectoryEdit", () => {
  it("starts from the saved folder and offers no update until it changes", async () => {
    await renderDialog(true);

    expect(input().value).toBe("/Saved");
    expect(button("Update").disabled).toBe(true);

    await type(" /Saved ");
    expect(button("Update").disabled).toBe(true);
  });

  it("does not offer a blank folder", async () => {
    await renderDialog(true, null);
    expect(input().value).toBe("");
    expect(button("Update").disabled).toBe(true);

    await type("   ");
    expect(button("Update").disabled).toBe(true);
  });

  it("hands back a typed folder trimmed and closes", async () => {
    await renderDialog(true);
    await type("  /Other ");
    await act(async () => button("Update").click());

    expect(onChange).toHaveBeenCalledWith("/Other");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes a folder picked from the tree", async () => {
    await renderDialog(true);
    const folder = defined(
      Array.from(container.querySelectorAll<HTMLElement>("span")).find(el => el.textContent === "Photos")
    );
    await act(async () => folder.click());

    expect(input().value).toBe("/Photos");
    await act(async () => button("Update").click());
    expect(onChange).toHaveBeenCalledWith("/Photos");
  });

  it("cancels without handing anything back", async () => {
    await renderDialog(true);
    await type("/Other");
    await act(async () => button("Cancel").click());

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts from the saved folder again when reopened", async () => {
    await renderDialog(true);
    await type("/Other");

    await renderDialog(false);
    await renderDialog(true);

    expect(input().value).toBe("/Saved");
  });
});
