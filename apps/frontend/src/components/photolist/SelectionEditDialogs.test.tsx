/** The selection's edit dialogs mount only while open; the move dialog marks the folder page's folder (#352). */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MovePhotosModal } from "../movephotos/MovePhotosModal";
import { SelectionEditDialogs } from "./SelectionEditDialogs";
import type { SelectionEditDialogState } from "./useSelectionEditDialogs";

const stubs = vi.hoisted(() => ({
  move: [] as Array<{ currentFolder?: string; selection: unknown }>,
  mounted: [] as string[],
}));

vi.mock("../movephotos/MovePhotosModal", () => ({
  MovePhotosModal: (props: React.ComponentProps<typeof MovePhotosModal>) => {
    stubs.move.push(props);
    return null;
  },
}));
vi.mock("../map/BulkLocationModal", () => ({
  BulkLocationModal: () => {
    stubs.mounted.push("location");
    return null;
  },
}));
vi.mock("./ChangeDateTimeModal", () => ({
  ChangeDateTimeModal: () => {
    stubs.mounted.push("datetime");
    return null;
  },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const closed = { opened: false, open: () => {}, close: () => {} };

async function render(dialogs: SelectionEditDialogState, pathname: string) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <SelectionEditDialogs
        dialogs={dialogs}
        selection={() => ({ image_hashes: ["h1"] })}
        onDone={() => {}}
        pathname={pathname}
      />
    );
  });
  await act(async () => root.unmount());
}

describe("SelectionEditDialogs", () => {
  it("mounts nothing while every dialog is closed", async () => {
    await render({ dateTime: closed, location: closed, move: closed }, "/");
    expect([stubs.mounted, stubs.move]).toEqual([[], []]);
  });

  it("marks the folder of a folder page in the move dialog", async () => {
    const open = { ...closed, opened: true };
    await render(
      { dateTime: open, location: open, move: open },
      `/album/folder/${encodeURIComponent("/p/2025 Porto")}`
    );
    expect(stubs.mounted).toEqual(["datetime", "location"]);
    expect(stubs.move.at(-1)).toMatchObject({ currentFolder: "/p/2025 Porto", selection: { image_hashes: ["h1"] } });

    await render({ dateTime: closed, location: closed, move: open }, "/");
    expect(stubs.move.at(-1)?.currentFolder).toBeUndefined();
  });
});
