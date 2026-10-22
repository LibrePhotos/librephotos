/**
 * #2035: New folder in the scan directory picker makes a folder inside the chosen one, puts it in
 * the tree and chooses it, so an admin can give a user a fresh library without a shell on the host.
 */
import type { CreatedFolder, DirTree } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DirectoryPicker, newFolderParent } from "./DirectoryPicker";

type CreateCallbacks = { onSuccess?: (folder: CreatedFolder) => void; onError?: (error: unknown) => void };

const stubs = vi.hoisted(() => ({
  create: vi.fn<(folder: { parent: string; name: string }, callbacks?: CreateCallbacks) => void>(),
  tree: [] as DirTree[],
  ApiError: class extends Error {
    constructor(public serverMessage: string | null) {
      super("request failed");
    }
  },
}));

vi.mock("../../api_client/folders/hooks", () => ({
  useFetchDirsQuery: () => ({ data: stubs.tree }),
}));
vi.mock("../../api_client/folders/hooks/useCreateFolderMutation", () => ({
  useCreateFolderMutation: () => ({ mutate: stubs.create, isPending: false }),
}));
vi.mock("../../api_client/apiError", () => ({ ApiError: stubs.ApiError }));

const folder = (absolute_path: string, children: DirTree[] = []): DirTree => ({
  title: absolute_path.split("/").pop() ?? "",
  absolute_path,
  children,
});

let root: Root;
let container: HTMLDivElement;
const changes: string[] = [];

function Harness({ initial }: Readonly<{ initial: string }>) {
  const [value, setValue] = useState(initial);
  return (
    <DirectoryPicker
      value={value}
      onChange={next => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

const render = async (initial = "/data/photos") => {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Harness initial={initial} />
      </MantineProvider>
    );
  });
};

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(candidate => candidate.textContent === label);
const nameInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Folder name"]');
const pathInput = () => container.querySelector<HTMLInputElement>('input[name="scan_directory"]');

const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const press = async (input: HTMLInputElement, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    input.dispatchEvent(event);
  });
  return event;
};
const openRow = async () => {
  await act(async () => button("New folder")?.click());
  const input = nameInput();
  if (!input) throw new Error("no folder name input");
  return input;
};

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.create.mockReset();
  stubs.tree = [folder("/data", [folder("/data/photos", [folder("/data/photos/niaz")])])];
  changes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("newFolderParent", () => {
  const tree = [folder("/data")];
  it("is the chosen folder, or the top of the tree while none is typed", () => {
    expect(newFolderParent("/data/photos", true, tree)).toBe("/data/photos");
    expect(newFolderParent("", true, tree)).toBe("/data");
  });

  it("is nothing for a path that is not a folder, or before the tree loaded", () => {
    expect(newFolderParent("/data/nope", false, tree)).toBeNull();
    expect(newFolderParent("", true, [])).toBeNull();
  });
});

describe("DirectoryPicker New folder (#2035)", () => {
  it("makes the folder in the chosen one on Enter and chooses it", async () => {
    await render();
    const input = await openRow();
    expect(container.textContent).toContain("In /data/photos");
    await type(input, "sam");

    const enter = await press(input, "Enter");

    // Enter makes the folder; it does not submit the user dialog around the picker.
    expect(enter.defaultPrevented).toBe(true);
    expect(stubs.create).toHaveBeenCalledWith({ parent: "/data/photos", name: "sam" }, expect.anything());
    const parent = folder("/data/photos", [folder("/data/photos/niaz"), folder("/data/photos/sam")]);
    await act(async () => stubs.create.mock.calls[0]?.[1]?.onSuccess?.({ absolute_path: "/data/photos/sam", parent }));

    expect(changes).toEqual(["/data/photos/sam"]);
    expect(pathInput()?.value).toBe("/data/photos/sam");
    expect(nameInput()).toBeNull();
  });

  it("refuses a name with a separator before asking the server", async () => {
    await render();
    const input = await openRow();
    await type(input, "../escape");

    await press(input, "Enter");

    expect(stubs.create).not.toHaveBeenCalled();
    expect(container.textContent).toContain("A folder name cannot contain");
  });

  it("shows why the server refused the folder", async () => {
    await render();
    const input = await openRow();
    await type(input, "CON");
    await press(input, "Enter");

    await act(async () =>
      stubs.create.mock.calls[0]?.[1]?.onError?.(new stubs.ApiError("That is a name Windows keeps for a device."))
    );

    expect(container.textContent).toContain("That is a name Windows keeps for a device.");
    expect(changes).toEqual([]);
  });

  it("closes the row on Escape, not the dialog around it, without making anything", async () => {
    await render();
    const input = await openRow();
    // Mantine's modals leave an Escape from such an element alone: the user dialog stays open.
    expect(input.getAttribute("data-mantine-stop-propagation")).toBe("true");

    await press(input, "Escape");

    expect(nameInput()).toBeNull();
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("makes the folder in the data root while no folder is typed", async () => {
    await render("");
    const input = await openRow();
    await type(input, "new");
    await press(input, "Enter");

    expect(stubs.create).toHaveBeenCalledWith({ parent: "/data", name: "new" }, expect.anything());
  });

  it("says why New folder waits while the typed path is not a folder", async () => {
    await render("/data/nope");

    const newFolder = button("New folder");
    expect(newFolder?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => newFolder?.click());
    expect(nameInput()).toBeNull();
  });
});
