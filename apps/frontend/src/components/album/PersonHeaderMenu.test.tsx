/**
 * The person page's "⋮" (#2207): Rename and Delete open the People page's dialogs, Delete goes
 * back to People once the person is gone, Manage faces opens the face dashboard, and "Merge
 * into…" picks another person, asks, and goes on to that person once merged (#2206). "Groups…"
 * opens a checklist of the user's groups that saves on every tick (#1126). "Set as cover…" picks
 * the cover from the person's loaded photos without selecting anything (#2240).
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
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
  useSetPersonAlbumCoverMutation,
  useSetPersonGroupsMutation,
} from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { PersonHeaderMenu } from "./PersonHeaderMenu";

type Rename = ReturnType<typeof useRenamePersonAlbumMutation>["mutate"];
type Delete = ReturnType<typeof useDeletePersonAlbumMutation>["mutate"];
type Merge = ReturnType<typeof useMergePersonMutation>["mutate"];
type SetGroups = ReturnType<typeof useSetPersonGroupsMutation>["mutate"];
type SetCover = ReturnType<typeof useSetPersonAlbumCoverMutation>["mutate"];
type CoverProps = React.ComponentProps<typeof AlbumCoverPickerModal>;

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  rename: vi.fn<Rename>(),
  remove: vi.fn<Delete>(),
  merge: vi.fn<Merge>(),
  setGroups: vi.fn<SetGroups>(),
  setCover: vi.fn<SetCover>(),
  birthDate: vi.fn<(from: HTMLElement | null) => void>(),
  cover: undefined as CoverProps | undefined,
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
  useFetchPersonGroupsQuery: () => ({
    data: [
      { id: 3, name: "Family", person_count: 1 },
      { id: 4, name: "Work", person_count: 0 },
    ],
    isLoading: false,
  }),
  useSetPersonGroupsMutation: () => ({ mutate: stubs.setGroups }),
  useCreatePersonGroupMutation: () => ({ mutateAsync: vi.fn<(name: string) => Promise<void>>(), isPending: false }),
  useSetPersonAlbumCoverMutation: () => ({ mutate: stubs.setCover }),
}));
vi.mock("../modals/AlbumCoverPickerModal", () => ({
  AlbumCoverPickerModal: (props: CoverProps) => {
    stubs.cover = props;
    return null;
  },
}));

const anna: Person = {
  id: "5",
  name: "Anna Becker",
  video: false,
  face_count: 3,
  face_photo_url: "hash",
  face_url: "",
  group_ids: [3],
  birth_date: null,
};

const tile = (id: string, isTemp = false): PigPhoto => ({
  id,
  image_hash: id,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp,
  has_raw_variant: false,
});

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
  stubs.setGroups.mockReset();
  stubs.setCover.mockReset();
  stubs.birthDate.mockReset();
  stubs.cover = undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        {/* A loaded photo and the placeholder of a day that has not loaded */}
        <PersonHeaderMenu person={anna} photos={[tile("h1"), tile("0", true)]} onBirthDate={stubs.birthDate} />
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
  it("offers rename, set as cover, groups, merge, manage faces and delete", async () => {
    await act(async () => button("Person actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual([
      "Rename",
      "Add birth date…",
      "Set as cover…",
      "Groups…",
      "Merge into…",
      "Manage Faces",
      "Delete Person",
    ]);
  });

  it("opens the birth date dialog, handing over the ⋮ button for the focus (#2750)", async () => {
    await pick("personbirthdate.menuadd");

    expect(stubs.birthDate).toHaveBeenCalledWith(button("Person actions"));
  });

  it("puts the person in a group on a tick, keeping the groups they are in", async () => {
    await pick("persongroups.menu");

    expect(document.body.textContent).toContain("Groups for Anna Becker");
    const box = (label: string) =>
      defined(
        Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(input =>
          input.closest("label, div")?.parentElement?.textContent?.includes(label)
        ),
        `the ${label} box`
      );
    expect(box("Family").checked).toBe(true);
    expect(box("Work").checked).toBe(false);
    await act(async () => box("Work").click());

    expect(stubs.setGroups).toHaveBeenCalledWith({ personId: "5", groupIds: [3, 4] }, expect.anything());
    expect(box("Work").checked).toBe(true);
  });

  it("picks the cover from the loaded photos, with nothing selected (#2240)", async () => {
    expect(stubs.cover?.isOpen).toBe(false);

    await pick("modalalbumcover.menuitem");

    const cover = defined(stubs.cover);
    expect(cover).toMatchObject({ isOpen: true, albumTitle: "Anna Becker" });
    expect(cover.photos.map(photo => photo.id)).toEqual(["h1"]);
    act(() => cover.onSelectCover("h1"));
    expect(stubs.setCover).toHaveBeenCalledWith({ id: "5", cover_photo: "h1" });
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
