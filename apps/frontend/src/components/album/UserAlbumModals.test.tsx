/**
 * The My Albums rename dialog rendered its "already exists" error as
 * `<>{t(...)}, {{ name }}</>`: a plain object as a React child. Typing any
 * existing album name, or opening the dialog again after one rename (the old
 * title stayed in state and now matched the renamed album), threw "Objects are
 * not valid as a React child" and replaced the whole app with the router's
 * error screen. Both album pages now share this dialog.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "./UserAlbumModals";

const stubs = vi.hoisted(() => ({ rename: vi.fn(), remove: vi.fn() }));

vi.mock("../../api_client/albums/hooks", () => ({
  useRenameUserAlbumMutation: () => ({ mutate: stubs.rename }),
  useDeleteUserAlbumMutation: () => ({ mutate: stubs.remove }),
}));

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
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.rename.mockReset();
  stubs.remove.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const onClose = vi.fn();

async function renderRename(opened: boolean, existingTitles: string[]) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <RenameUserAlbumModal
          opened={opened}
          onClose={onClose}
          albumId="1"
          albumTitle="Holiday"
          existingTitles={existingTitles}
        />
      </MantineProvider>
    );
  });
}

const input = () => container.querySelector<HTMLInputElement>("input")!;
const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label)!;

async function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the rename dialog", () => {
  it("says a title is taken instead of crashing", async () => {
    await renderRename(true, ["Holiday", "Trip"]);
    await type(" trip ");

    expect(container.textContent).toContain("Album trip already exists.");
    expect(button("Rename").disabled).toBe(true);
  });

  it("does not offer to rename to an empty title", async () => {
    await renderRename(true, ["Holiday"]);
    expect(button("Rename").disabled).toBe(true);

    await type("   ");
    expect(button("Rename").disabled).toBe(true);
  });

  it("renames to the trimmed title", async () => {
    await renderRename(true, ["Holiday"]);
    await type(" Beach ");
    await act(async () => button("Rename").click());

    expect(stubs.rename).toHaveBeenCalledWith({ id: "1", title: "Holiday", newTitle: "Beach" });
    expect(onClose).toHaveBeenCalled();
  });

  it("opens empty again after a rename, even though that title now exists", async () => {
    await renderRename(true, ["Holiday"]);
    await type("Beach");
    await act(async () => button("Rename").click());

    // The list refetched with the new title; the dialog is closed and opened again.
    await renderRename(false, ["Beach"]);
    await renderRename(true, ["Beach"]);

    expect(input().value).toBe("");
    expect(container.textContent).not.toContain("already exists");
  });
});

describe("the delete dialog", () => {
  it("deletes the album it was opened for", async () => {
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <DeleteUserAlbumModal opened onClose={onClose} albumId="7" albumTitle="Trip" />
        </MantineProvider>
      );
    });
    await act(async () => button("Confirm").click());

    expect(stubs.remove).toHaveBeenCalledWith({ id: "7", albumTitle: "Trip" });
  });
});
