/**
 * #123: the folders of a library as rows. Everyone sees theirs; admins add a folder through the
 * folder picker and remove a further one, optionally moving its photos to the user's trash.
 */
import type {
  ExcludedFoldersSaved,
  LibraryFolderEntry,
  LibraryFolders,
  LibrarySubfolder,
} from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LibraryFolderList } from "./LibraryFolderList";

type MutateOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };
type SaveOptions = { onSuccess?: (saved: ExcludedFoldersSaved) => void };

const stubs = vi.hoisted(() => ({
  query: {
    data: undefined as LibraryFolders | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  },
  owners: [] as (number | "self")[],
  add: vi.fn<(path: string, options: MutateOptions) => void>(),
  remove: vi.fn<(folderId: number, options: MutateOptions) => void>(),
  trash: vi.fn<(variables: { userId: number; username: string; count: number }) => void>(),
  excluded: [] as string[],
  subfolders: {} as Record<string, LibrarySubfolder[]>,
  saveExcluded: vi.fn<(paths: string[], options: SaveOptions) => void>(),
  trashOwn: vi.fn<(variables: { username: string; count: number }) => void>(),
}));

vi.mock("../../api_client/user/hooks/useLibraryFolders", () => ({
  useLibraryFoldersQuery: (owner: number | "self") => {
    stubs.owners.push(owner);
    return stubs.query;
  },
  useAddLibraryFolderMutation: () => ({ mutate: stubs.add, isPending: false }),
  useRemoveLibraryFolderMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));
vi.mock("../../api_client/jobs/hooks/useTrashPhotosOutsideLibraryMutation", () => ({
  useTrashPhotosOutsideLibraryMutation: () => ({ mutate: stubs.trash }),
}));
vi.mock("../../api_client/user/hooks/useExcludedFolders", () => ({
  useLibrarySubfoldersQuery: (path: string) => ({
    data: { path, subfolders: stubs.subfolders[path] ?? [], truncated: false },
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSetExcludedFoldersMutation: () => ({ mutate: stubs.saveExcluded, isPending: false }),
  useTrashOwnPhotosOutsideLibraryMutation: () => ({ mutate: stubs.trashOwn }),
}));
vi.mock("../../api_client/folders/hooks", () => ({ useFetchDirsQuery: () => ({ data: undefined }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const MAIN: LibraryFolderEntry = { id: null, path: "/data/anna", kind: "main", available: true, photo_count: 12 };
const FAMILY: LibraryFolderEntry = { id: 3, path: "/data/family", kind: "folder", available: true, photo_count: 5 };
const USB: LibraryFolderEntry = { id: 4, path: "/mnt/usb", kind: "folder", available: false, photo_count: 0 };

let container: HTMLElement;
let unmount: (() => Promise<void>) | undefined;

async function render(
  canManage: boolean,
  folders: LibraryFolderEntry[] = [MAIN, FAMILY, USB],
  owner: number | "self" = "self"
) {
  stubs.query = { ...stubs.query, data: { folders, excluded_folders: stubs.excluded } };
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <LibraryFolderList owner={owner} userId={7} username="anna" canManage={canManage} />
      </MantineProvider>
    )
  );
  unmount = () => act(async () => root.unmount());
}

const button = (label: string) =>
  defined([...container.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label));

async function openRowMenu(index: number) {
  const menus = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Folder actions"]');
  await click(defined(menus[index]));
}

const menuItem = (label: string) =>
  defined(
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === label)
  );

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.owners = [];
  stubs.add.mockReset();
  stubs.remove.mockReset();
  stubs.trash.mockReset();
  stubs.excluded = [];
  stubs.subfolders = {};
  stubs.saveExcluded.mockReset();
  stubs.trashOwn.mockReset();
});

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  document.body.innerHTML = "";
});

describe("LibraryFolderList", () => {
  it("lists every folder with what it is and how many photos it holds", async () => {
    await render(false);

    const text = container.textContent ?? "";
    expect(stubs.owners.at(-1)).toBe("self");
    expect(text).toContain("/data/anna");
    expect(text).toContain("Main folder");
    expect(text).toContain("12 photos");
    expect(text).toContain("/data/family");
    expect(text).toContain("Not found");
    expect(text).toContain("scans skip it and keep its photos");
  });

  it("offers no Add or Remove to a user who is not an admin", async () => {
    await render(false);

    expect(container.textContent).not.toContain("Add folder");
    await openRowMenu(1);
    expect(document.body.textContent).toContain("Open in Folders");
    expect(document.body.textContent).not.toContain("Remove…");
  });

  it("never offers to remove the main folder", async () => {
    await render(true);

    await openRowMenu(0);
    expect(document.body.textContent).not.toContain("Remove…");
  });

  it("removes a further folder and moves its photos to the trash when asked", async () => {
    stubs.remove.mockImplementation((_id, options) => options.onSuccess?.());
    await render(true);

    await openRowMenu(1);
    await click(menuItem("Remove…"));
    expect(openDialog()?.textContent).toContain("/data/family");
    const checkbox = defined(openDialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await click(checkbox);
    await click(dialogButton("Remove folder"));

    expect(stubs.remove).toHaveBeenCalledWith(3, expect.anything());
    expect(stubs.trash).toHaveBeenCalledWith({ userId: 7, username: "anna", count: 5 });
  });

  it("removes a folder without touching its photos by default", async () => {
    stubs.remove.mockImplementation((_id, options) => options.onSuccess?.());
    await render(true);

    await openRowMenu(1);
    await click(menuItem("Remove…"));
    await click(dialogButton("Remove folder"));

    expect(stubs.remove).toHaveBeenCalledTimes(1);
    expect(stubs.trash).not.toHaveBeenCalled();
  });

  it("adds the picked folder and shows why the server refused one", async () => {
    stubs.add.mockImplementation((_path, options) => options.onError?.(new Error("no")));
    await render(true);

    await click(button("Add folder"));
    const input = defined(openDialog()?.querySelector<HTMLInputElement>('input[name="library_folder"]'));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "/data/more");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(dialogButton("Add folder"));

    expect(stubs.add).toHaveBeenCalledWith("/data/more", expect.anything());
    expect(openDialog()?.textContent).toContain("The folder could not be added.");
  });

  it("asks for a folder before adding", async () => {
    await render(true);

    await click(button("Add folder"));
    await click(dialogButton("Add folder"));

    expect(stubs.add).not.toHaveBeenCalled();
    expect(openDialog()?.textContent).toContain("Choose a folder");
  });

  it("says why Add folder is off without a scan directory", async () => {
    await render(true, []);

    expect(container.textContent).toContain("No library folders yet.");
    expect(button("Add folder").getAttribute("aria-disabled")).toBe("true");
  });

  it("says how many subfolders a folder leaves out (#791)", async () => {
    stubs.excluded = ["/data/family/trip", "/data/family/old/2001"];
    await render(false);

    expect(container.textContent).toContain("2 subfolders left out");
  });

  it("leaves a subfolder out and moves the photos outside the library to the trash when asked", async () => {
    stubs.subfolders["/data/family"] = [
      { name: "trip", path: "/data/family/trip", excluded: false, has_subfolders: false, photo_count: 4 },
      { name: "xmas", path: "/data/family/xmas", excluded: false, has_subfolders: false, photo_count: 1 },
    ];
    stubs.saveExcluded.mockImplementation((_paths, options) =>
      options.onSuccess?.({ folders: [], excluded_folders: ["/data/family/trip"], outside_count: 4 })
    );
    await render(false);

    await openRowMenu(1);
    await click(menuItem("Leave out subfolders…"));
    const dialog = defined(openDialog());
    const trip = defined(
      [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(box =>
        box.closest("li")?.textContent?.includes("trip")
      )
    );
    expect(trip.checked).toBe(true);
    await click(trip);
    expect(openDialog()?.textContent).toContain("stay in your library until you move them to the trash");
    const trash = defined(
      [...defined(openDialog()).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        box => !box.closest("li")
      )
    );
    await click(trash);
    await click(dialogButton("Save"));

    expect(stubs.saveExcluded).toHaveBeenCalledWith(["/data/family/trip"], expect.anything());
    expect(stubs.trashOwn).toHaveBeenCalledWith({ username: "anna", count: 4 });
  });

  it("offers no Leave out in another user's list", async () => {
    await render(true, [MAIN, FAMILY], 7);

    await openRowMenu(1);
    expect(document.body.textContent).toContain("Remove…");
    expect(document.body.textContent).not.toContain("Leave out subfolders…");
  });
});
