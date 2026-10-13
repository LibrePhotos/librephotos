/**
 * The person page's "⋮" (#2207): Rename and Delete open the People page's dialogs, Delete goes
 * back to People once the person is gone, Manage faces opens the face dashboard.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";
import type { UseNavigateResult } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person, useDeletePersonAlbumMutation, useRenamePersonAlbumMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonHeaderMenu } from "./PersonHeaderMenu";

type Rename = ReturnType<typeof useRenamePersonAlbumMutation>["mutate"];
type Delete = ReturnType<typeof useDeletePersonAlbumMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  rename: vi.fn<Rename>(),
  remove: vi.fn<Delete>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: () => ({ data: [{ name: "Anna Becker" }, { name: "Jonas" }] }),
  useRenamePersonAlbumMutation: () => ({ mutate: stubs.rename }),
  useDeletePersonAlbumMutation: () => ({ mutate: stubs.remove }),
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

beforeEach(async () => {
  stubs.navigate.mockReset();
  stubs.rename.mockReset();
  stubs.remove.mockReset();
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
    expect(items).toEqual(["Rename", "Manage Faces", "Delete Person"]);
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
    await act(async () => button("Delete").click());

    expect(stubs.remove).toHaveBeenCalledTimes(1);
    const [id, options] = defined(stubs.remove.mock.calls[0]);
    expect(id).toBe("5");
    act(() => options?.onSuccess?.(undefined, "5", undefined, { client: new QueryClient(), meta: undefined }));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/persons" });
  });
});
