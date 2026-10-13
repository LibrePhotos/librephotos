/**
 * The person page's "⋮" (#2207): Rename and Delete open the People page's dialogs, Delete goes
 * back to People once the person is gone, Manage faces opens the face dashboard, and "Merge
 * into…" picks another person, asks, and goes on to that person once merged (#2206).
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";
import type { UseNavigateResult } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Person,
  useDeletePersonAlbumMutation,
  useMergePersonMutation,
  useRenamePersonAlbumMutation,
} from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonHeaderMenu } from "./PersonHeaderMenu";

type Rename = ReturnType<typeof useRenamePersonAlbumMutation>["mutate"];
type Delete = ReturnType<typeof useDeletePersonAlbumMutation>["mutate"];
type Merge = ReturnType<typeof useMergePersonMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  rename: vi.fn<Rename>(),
  remove: vi.fn<Delete>(),
  merge: vi.fn<Merge>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: () => ({
    data: [
      { id: "5", name: "Anna Becker" },
      { id: "6", name: "Jonas" },
    ],
  }),
  useRenamePersonAlbumMutation: () => ({ mutate: stubs.rename }),
  useDeletePersonAlbumMutation: () => ({ mutate: stubs.remove }),
  useMergePersonMutation: () => ({ mutate: stubs.merge, isPending: false }),
}));

const anna: Person = {
  id: "5",
  name: "Anna Becker",
  video: false,
  face_count: 3,
  face_photo_url: "hash",
  face_url: "",
};

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
  // jsdom has no ResizeObserver, the merge picker's dropdown needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

beforeEach(async () => {
  stubs.navigate.mockReset();
  stubs.rename.mockReset();
  stubs.remove.mockReset();
  stubs.merge.mockReset();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <PersonHeaderMenu person={anna} />
      </MantineProvider>
    )
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

async function pick(key: ParseKeys) {
  await act(async () => button(i18n.t("personalbum.personactions")).click());
  await act(async () => button(i18n.t(key)).click());
}

describe("PersonHeaderMenu", () => {
  it("offers rename, manage faces and delete", async () => {
    await act(async () => button("Person actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual(["Rename", "Merge into…", "Manage Faces", "Delete Person"]);
  });

  it("opens the face dashboard", async () => {
    await pick("personalbum.managefaces");

    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/faces" });
  });

  it("renames through the People page's dialog, with its duplicate check", async () => {
    await pick("rename");

    expect(document.body.textContent).toContain("What do you want to rename Anna Becker to?");
    const input = defined(document.body.querySelector<HTMLInputElement>("input"), "the name input");
    const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
    await act(async () => {
      setValue.call(input, "jonas");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Person jonas already exists.");

    await act(async () => {
      setValue.call(input, "Anna B.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Rename").closest("form")?.requestSubmit());
    expect(stubs.rename).toHaveBeenCalledWith({ id: "5", personName: "Anna Becker", newPersonName: "Anna B." });
  });

  it("deletes after asking, then goes back to People", async () => {
    await pick("personalbum.deleteperson");

    expect(document.body.textContent).toContain("Delete Anna Becker?");
    expect(document.body.textContent).toContain("The 3 faces labelled Anna Becker go back to unknown faces");
    const dialog = defined(document.body.querySelector('[role="dialog"]'), "the confirmation");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      el => el.textContent?.trim() === "Delete Person"
    );
    await act(async () => defined(confirm, "the confirm button").click());

    expect(stubs.remove).toHaveBeenCalledTimes(1);
    const [id, options] = defined(stubs.remove.mock.calls[0]);
    expect(id).toBe("5");
    act(() => options?.onSuccess?.(undefined, "5", undefined, { client: new QueryClient(), meta: undefined }));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/persons" });
  });

  it("merges into a chosen person after asking, then shows that person", async () => {
    await pick("personalbum.mergeintomenu");

    expect(document.body.textContent).toContain("Merge Anna Becker into…");
    const search = defined(document.body.querySelector<HTMLInputElement>("input"), "the person search");
    // The person merged away is no choice
    await act(async () => search.click());
    const options = Array.from(document.body.querySelectorAll('[role="option"]')).map(el => el.textContent);
    expect(options).toEqual(["Jonas"]);
    await act(async () => (defined(document.body.querySelector('[role="option"]'), "Jonas") as HTMLElement).click());
    await act(async () => button("Continue").click());

    expect(document.body.textContent).toContain("Merge Anna Becker into Jonas?");
    expect(stubs.merge).not.toHaveBeenCalled();
    await act(async () => button("Merge people").click());

    const [params, options_] = defined(stubs.merge.mock.calls[0]);
    expect(params).toEqual({ targetId: "6", targetName: "Jonas", sourceId: "5", sourceName: "Anna Becker" });
    const answer = { moved: 3, photo_count: 2, write_queued: false };
    act(() => options_?.onSuccess?.(answer, params, undefined, { client: new QueryClient(), meta: undefined }));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/persons/$id", params: { id: "6" } });
  });

  it("offers the merge when renaming to another person's name", async () => {
    await pick("rename");
    const input = defined(document.body.querySelector<HTMLInputElement>("input"), "the name input");
    const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
    await act(async () => {
      setValue.call(input, "jonas");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Merge into Jonas").click());
    await act(async () => button("Merge people").click());

    const [params, options] = defined(stubs.merge.mock.calls[0]);
    expect(params).toMatchObject({ targetId: "6", sourceId: "5" });
    act(() =>
      options?.onSuccess?.({ moved: 3, photo_count: 2, write_queued: true }, params, undefined, {
        client: new QueryClient(),
        meta: undefined,
      })
    );
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/persons/$id", params: { id: "6" } });
  });
});
