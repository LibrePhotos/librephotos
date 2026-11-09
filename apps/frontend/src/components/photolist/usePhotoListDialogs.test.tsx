/**
 * The photo list's modals were four independent disclosures, so the "t" hotkey opened Tag over
 * another open modal (Share, Add to album) and both showed at once.
 */
import { PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import type { ListSelection } from "./photoListSelection";
import { usePhotoListDialogs } from "./usePhotoListDialogs";
import type { PhotoListDialogState } from "./usePhotoListDialogs";

const picked: ListSelection = {
  kind: "some",
  items: [PigPhoto.parse({ id: "00000000-0000-4000-8000-000000000001", image_hash: "h1", aspectRatio: 1 })],
  keepOpen: false,
};

let latest: PhotoListDialogState | undefined;
let unmount: (() => void) | undefined;

function Host({ hotkeyEnabled = true }: Readonly<{ hotkeyEnabled?: boolean }>) {
  latest = usePhotoListDialogs({ isPublic: false, readSelection: () => picked, hotkeyEnabled });
  return null;
}

async function render(element: React.ReactElement) {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(element));
  unmount = () => act(() => root.unmount());
  return defined(latest);
}

const current = () => defined(latest);
const pressT = () =>
  act(async () => {
    document.documentElement.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", bubbles: true }));
  });

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  unmount?.();
  latest = undefined;
});

describe("usePhotoListDialogs", () => {
  it("opens Tag from the keyboard for a selection", async () => {
    await render(<Host />);
    await pressT();
    expect(current().tag.opened).toBe(true);
  });

  it("does not stack Tag over another open modal", async () => {
    await render(<Host />);
    await act(async () => current().sharePhotos.open());
    await pressT();

    expect(current().tag.opened).toBe(false);
    expect(current().sharePhotos.opened).toBe(true);
  });

  it("leaves the keyboard to the lightbox", async () => {
    await render(<Host hotkeyEnabled={false} />);
    await pressT();
    expect(current().tag.opened).toBe(false);
  });

  it("opens one modal at a time, and a late close of the first leaves the second open", async () => {
    await render(<Host />);
    await act(async () => current().addToAlbum.open());
    await act(async () => current().tag.open());
    expect(current().addToAlbum.opened).toBe(false);

    await act(async () => current().addToAlbum.close());
    expect(current().tag.opened).toBe(true);
  });
});
