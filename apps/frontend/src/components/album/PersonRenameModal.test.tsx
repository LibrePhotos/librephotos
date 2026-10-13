/**
 * Renaming a person from the people page. The backend refuses a blank name and nothing would
 * report it, so Rename stays disabled for one; a name another person has (trimmed, any case) is
 * refused with an error and offers to merge into that person (#2206), which runs after a
 * confirmation; the new name is handed back trimmed; Enter renames too; and every opening starts
 * with an empty name.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useMergePersonMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonRenameModal } from "./PersonRenameModal";

type Merge = ReturnType<typeof useMergePersonMutation>["mutate"];

const stubs = vi.hoisted(() => ({ merge: vi.fn<Merge>() }));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useMergePersonMutation: () => ({ mutate: stubs.merge, isPending: false }),
}));

const person = { id: "7", name: "Sofia", video: false, face_count: 3, face_photo_url: "/f", face_url: "/f" };
const onClose = vi.fn<() => void>();
const onSubmit = vi.fn<(newName: string) => void>();
const onMerged = vi.fn<(targetId: string) => void>();

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
          people={[
            { id: "7", name: "Sofia" },
            { id: "8", name: "Miguel" },
          ]}
          onSubmit={onSubmit}
          onMerged={onMerged}
        />
      </MantineProvider>
    );
  });
}

const input = () => defined(container.querySelector<HTMLInputElement>("input"), "the name input");
const findButton = (text: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === text);
const renameButton = () => defined(findButton("Rename"), "the Rename button");
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

  it("refuses a name another person has, trimmed and in any case, and offers a merge", async () => {
    await renderDialog(true);
    await type(" miguel ");

    expect(container.textContent).toContain("Person miguel already exists.");
    expect(findButton("Rename")).toBeUndefined();
    expect(findButton("Merge into Miguel")).toBeDefined();
    // Enter never merges: that takes the button and a confirmation
    await pressEnter();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(stubs.merge).not.toHaveBeenCalled();
  });

  it("does not offer to merge a person into themselves", async () => {
    await renderDialog(true);
    await type("SOFIA");

    expect(container.textContent).toContain("Person SOFIA already exists.");
    expect(renameButton().disabled).toBe(true);
    expect(findButton("Merge into Sofia")).toBeUndefined();
  });

  it("merges into the person with that name after a confirmation", async () => {
    await renderDialog(true);
    await type("miguel");
    await act(async () => defined(findButton("Merge into Miguel"), "the merge button").click());

    // The rename dialog gives way to the confirmation
    expect(onClose).toHaveBeenCalledTimes(1);
    await renderDialog(false);
    expect(container.textContent).toContain("Merge Sofia into Miguel?");
    expect(container.textContent).toContain("All 3 faces of Sofia move to Miguel.");
    expect(container.textContent).toContain("Miguel keeps their name and cover photo.");
    expect(stubs.merge).not.toHaveBeenCalled();

    await act(async () => defined(findButton("Merge people"), "the confirm button").click());

    expect(stubs.merge).toHaveBeenCalledTimes(1);
    const [params, options] = defined(stubs.merge.mock.calls[0]);
    expect(params).toEqual({ targetId: "8", targetName: "Miguel", sourceId: "7", sourceName: "Sofia" });
    const answer = { moved: 3, photo_count: 3, write_queued: false };
    act(() => options?.onSuccess?.(answer, params, undefined, { client: new QueryClient(), meta: undefined }));
    expect(onMerged).toHaveBeenCalledWith("8");
  });

  it("does not merge when the confirmation is cancelled", async () => {
    await renderDialog(true);
    await type("Miguel");
    await act(async () => defined(findButton("Merge into Miguel"), "the merge button").click());
    await renderDialog(false);
    await act(async () => defined(findButton("Cancel"), "the cancel button").click());

    expect(stubs.merge).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Merge Sofia into Miguel?");
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
