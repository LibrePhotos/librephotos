/**
 * The select-all button counted an empty grid as "all selected" (0 === 0), so
 * it was labelled "Deselect all" while a click selected all.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PigPhoto } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { SelectionBar } from "./SelectionBar";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Partial<React.ComponentProps<typeof SelectionBar>>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MantineProvider>
        <SelectionBar
          selectMode={false}
          selectAllMode={false}
          updateSelectionState={() => {}}
          selectedItems={[]}
          idx2hash={[]}
          totalCount={0}
          {...props}
        />
      </MantineProvider>
    );
  });
  return container.querySelector<HTMLButtonElement>("button")!;
}

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

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SelectionBar select-all button", () => {
  it("offers Select all on an empty grid, matching what a click does", async () => {
    const updateSelectionState = vi.fn();
    const button = await render({ updateSelectionState });

    expect(button.getAttribute("aria-label")).toBe("Select all");
    await act(async () => button.click());
    expect(updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: true }));
  });

  it("offers Deselect all once every loaded item is selected", async () => {
    const items = [1, 2].map(n =>
      PigPhoto.parse({ id: `00000000-0000-4000-8000-00000000000${n}`, image_hash: `hash-${n}`, aspectRatio: 1 })
    );
    const button = await render({ idx2hash: items, selectedItems: items, selectMode: true });

    expect(button.getAttribute("aria-label")).toBe("Deselect all");
  });
});
