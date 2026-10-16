/**
 * "Move to folder…" (#352): pick a folder of the library in the tree (or name a new one), see what
 * the move does, move; a taken name opens the second dialog with Rename and Skip.
 */
import type { LibraryFolderListing, MoveOnConflict, MovePreviewResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { MovePhotosModal } from "./MovePhotosModal";

type Request = { selection: PhotoSelection; targetFolder: string; onConflict?: MoveOnConflict };
type Callbacks = { onSuccess?: () => void; onError?: (error: unknown) => void };

const CONFLICT = new Error("name_conflict");

const stubs = vi.hoisted(() => ({
  folders: new Map<string | null, LibraryFolderListing>(),
  previews: new Map<string, MovePreviewResponse>(),
  mutate: vi.fn<(request: Request, callbacks?: Callbacks) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
}));

vi.mock("../../api_client/folders/hooks", () => ({
  useMoveFoldersQuery: (path: string | null, enabled = true) => ({
    data: enabled ? stubs.folders.get(path) : undefined,
    isPending: !enabled,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
}));
vi.mock("../../api_client/photos/hooks/useMovePreviewQuery", () => ({
  useMovePreviewQuery: (_selection: PhotoSelection, target: string | null) => ({
    data: target === null ? undefined : stubs.previews.get(target),
    isError: false,
    isFetching: false,
    error: null,
    refetch: stubs.refetch,
  }),
}));
vi.mock("../../api_client/photos/hooks/useMovePhotosMutation", () => ({
  useMovePhotosMutation: () => ({ mutate: stubs.mutate, isPending: false }),
  isNameConflict: (error: unknown) => error === CONFLICT,
}));
// The preview is asked for at once instead of after the typing pause.
vi.mock("@mantine/hooks", async importOriginal => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useDebouncedValue: <T,>(value: T) => [value, () => {}],
}));

const SELECTION: PhotoSelection = { image_hashes: ["h1", "h2"] };
const preview = (overrides: Partial<MovePreviewResponse> = {}): MovePreviewResponse => ({
  target_folder: "/photos/2025",
  photos: 2,
  files: 3,
  unchanged: 0,
  refused: [],
  clashes: [],
  ...overrides,
});

const onClose = vi.fn<() => void>();
const onDone = vi.fn<() => void>();
let root: Root;

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

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.folders.clear();
  stubs.folders.set(null, {
    path: null,
    folders: [{ name: "photos", path: "/photos", has_subfolders: true }],
    truncated: false,
  });
  stubs.folders.set("/photos", {
    path: "/photos",
    folders: [
      { name: "2024", path: "/photos/2024", has_subfolders: false },
      { name: "2025", path: "/photos/2025", has_subfolders: false },
    ],
    truncated: false,
  });
  stubs.previews.clear();
  stubs.previews.set("/photos/2025", preview());
  stubs.mutate.mockReset();
  stubs.mutate.mockImplementation((_request, callbacks) => callbacks?.onSuccess?.());
  stubs.refetch.mockClear();
  onClose.mockReset();
  onDone.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function open() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      // No transitions, so the second dialog shows without waiting for animation frames.
      <MantineProvider theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}>
        <MovePhotosModal opened onClose={onClose} selection={SELECTION} onDone={onDone} currentFolder="/photos/2024" />
      </MantineProvider>
    );
  });
}

function buttonWithText(text: string) {
  return defined(Array.from(document.querySelectorAll("button")).find(b => b.textContent === text));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const destination = () =>
  defined(
    Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      field => field.labels?.[0]?.textContent === "Destination"
    )
  );

describe("MovePhotosModal", () => {
  it("lists the library and marks the folder the photos are in", async () => {
    await open();

    const tree = defined(document.querySelector('[role="tree"]'));
    expect(Array.from(tree.querySelectorAll('[role="treeitem"]')).map(item => item.getAttribute("aria-level"))).toEqual(
      ["1", "2", "2"]
    );
    expect(tree.textContent).toContain("2024Current");
    expectDisabledWithReason(buttonWithText("Move 0 photos"), "Pick a folder of your library.");
  });

  it("moves to the folder picked in the tree", async () => {
    await open();

    await click(buttonWithText("2025"));

    expect(destination().value).toBe("/photos/2025");
    expect(document.body.textContent).toContain("2 photos with 3 files will move.");
    await click(buttonWithText("Move 2 photos"));
    expect(defined(stubs.mutate.mock.calls[0])[0]).toEqual({
      selection: SELECTION,
      targetFolder: "/photos/2025",
      onConflict: undefined,
    });
    expect(onClose).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("says which photos stay and why", async () => {
    stubs.previews.set(
      "/photos/2025",
      preview({ photos: 0, files: 0, unchanged: 1, refused: [{ reason: "nextcloud", photos: 1 }] })
    );
    await open();
    await click(buttonWithText("2025"));

    expect(document.body.textContent).toContain("1 photo is already in this folder.");
    expect(document.body.textContent).toContain("1 photo is a copy of a Nextcloud file and stays where it is.");
    expectDisabledWithReason(buttonWithText("Move 0 photos"), "None of the selected photos can move here.");
  });

  it("asks what to do with a taken name, then renames", async () => {
    stubs.previews.set(
      "/photos/2025",
      preview({
        clashes: [{ photo_id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10", name: "IMG_1.jpg", renamed_to: "IMG_1 (1).jpg" }],
      })
    );
    await open();
    await click(buttonWithText("2025"));
    await click(buttonWithText("Move 2 photos"));

    expect(stubs.mutate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 name is taken in 2025");
    expect(document.body.textContent).toContain("IMG_1 (1).jpg");
    await click(buttonWithText("Rename, keep both"));
    expect(defined(stubs.mutate.mock.calls[0])[0].onConflict).toBe("rename");
  });

  it("asks when a name was taken after the preview, and can skip those photos", async () => {
    const clash = { photo_id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10", name: "IMG_1.jpg", renamed_to: null };
    stubs.mutate.mockImplementationOnce((_request, callbacks) => callbacks?.onError?.(CONFLICT));
    // The preview read again after the server's 409 has the clash.
    stubs.refetch.mockImplementationOnce(() => {
      stubs.previews.set("/photos/2025", preview({ clashes: [clash] }));
      return Promise.resolve();
    });
    await open();
    await click(buttonWithText("photos"));
    await typeInto(destination(), "/photos/2025");
    await click(buttonWithText("Move 2 photos"));

    expect(stubs.refetch).toHaveBeenCalled();
    expect(document.body.textContent).toContain("No free name");
    await click(buttonWithText("Skip this photo"));
    expect(defined(stubs.mutate.mock.calls[1])[0].onConflict).toBe("skip");
  });

  it("names a new folder inside the picked one", async () => {
    stubs.previews.set("/photos/Porto", preview({ target_folder: "/photos/Porto" }));
    await open();
    await click(buttonWithText("photos"));
    await click(buttonWithText("New folder"));
    const name = defined(document.querySelector<HTMLInputElement>('input[aria-label="New folder name"]'));
    await typeInto(name, "Porto");
    await click(buttonWithText("Add"));

    expect(destination().value).toBe("/photos/Porto");
    expect(defined(document.querySelector('[role="tree"]')).textContent).toContain("PortoNew");
  });

  it("refuses a folder name the scan would skip", async () => {
    await open();
    await click(buttonWithText("photos"));
    await click(buttonWithText("New folder"));
    await typeInto(defined(document.querySelector<HTMLInputElement>('input[aria-label="New folder name"]')), ".hidden");

    expect(document.body.textContent).toContain("A folder name has no / or \\ and does not start with a dot.");
  });
});
