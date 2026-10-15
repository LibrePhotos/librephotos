/**
 * The select-all button counted an empty grid as "all selected" (0 === 0), so
 * it was labelled "Deselect all" while a click selected all.
 */
import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { tempPigPhoto } from "../../util/util";
import { SelectionBar } from "./SelectionBar";

type SelectionBarProps = React.ComponentProps<typeof SelectionBar>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Partial<SelectionBarProps>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const hostRoot = createRoot(host);
  container = host;
  root = hostRoot;
  await act(async () => {
    hostRoot.render(
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
  const button = host.querySelector("button");
  if (!button) throw new Error("SelectionBar rendered no button");
  return button;
}

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

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SelectionBar select-all button", () => {
  it("offers Select all on an empty grid, matching what a click does", async () => {
    const updateSelectionState = vi.fn<SelectionBarProps["updateSelectionState"]>();
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

// #2227: a paginated page without a server-side query can only select what it has loaded,
// so the bar must not claim more than that.
describe("SelectionBar on a partly loaded page without a query", () => {
  const loaded = [1, 2].map(n =>
    PigPhoto.parse({ id: `00000000-0000-4000-8000-00000000000${n}`, image_hash: `hash-${n}`, aspectRatio: 1 })
  );
  const placeholders = [3, 4, 5].map(n => tempPigPhoto(`temp-${n}`));
  const idx2hash = [...loaded, ...placeholders];

  it("offers to select the loaded photos and selects only those", async () => {
    const updateSelectionState = vi.fn<SelectionBarProps["updateSelectionState"]>();
    const button = await render({ idx2hash, totalCount: 5, updateSelectionState });

    expect(button.getAttribute("aria-label")).toBe("Select the loaded photos");
    await act(async () => button.click());
    expect(updateSelectionState).toHaveBeenCalledWith(
      expect.objectContaining({ selectAllMode: false, selectedItems: loaded })
    );
  });

  it("counts the selection against the total, not as all", async () => {
    await render({ idx2hash, totalCount: 5, selectedItems: loaded, selectMode: true });

    expect(defined(container).textContent).toContain("2 of 5 selected");
    const button = defined(container?.querySelector("button"));
    expect(button.getAttribute("aria-label")).toBe("Select the loaded photos");
  });
});

// #2201: each label is one translated sentence with the numbers in it, never a number glued to
// separately translated words, so a language can put the count where its grammar needs it.
describe("SelectionBar count label", () => {
  const photos = [1, 2, 3].map(n =>
    PigPhoto.parse({ id: `00000000-0000-4000-8000-00000000000${n}`, image_hash: `hash-${n}`, aspectRatio: 1 })
  );
  // The select mode toggle, the second button, carries the label
  const label = () => defined(container?.querySelectorAll("button")[1]).textContent;

  it("counts a manual selection", async () => {
    await render({ idx2hash: photos, selectedItems: photos.slice(0, 2), selectMode: true, totalCount: 3 });
    expect(label()).toContain("2 selected");
  });

  it("names the whole set after Select all, grouping the digits", async () => {
    await render({ selectMode: true, selectAllMode: true, totalCount: 25123 });
    expect(label()).toContain("All 25,123 selected");
  });

  it("says how many photos were taken out of Select all again", async () => {
    await render({ selectMode: true, selectAllMode: true, selectedItems: photos, totalCount: 120 });
    expect(label()).toContain("All 120 selected (3 excluded)");
  });

  it("renders each variant from its single key", async () => {
    // A stand-in sentence that orders the numbers differently: any English glued around it shows.
    const sentences = {
      count_other: "[{{count, number}}]",
      allcount_other: "[*{{count, number}}]",
      allexcluded_other: "[{{count, number}}/{{total, number}}]",
    };
    i18n.addResourceBundle("xx", "translation", { selectionbar: sentences });
    await i18n.changeLanguage("xx");
    try {
      await render({ idx2hash: photos, selectedItems: photos.slice(0, 2), selectMode: true, totalCount: 3 });
      expect(label()).toBe("[2]");
      await render({ selectMode: true, selectAllMode: true, totalCount: 120 });
      expect(label()).toBe("[*120]");
      await render({ selectMode: true, selectAllMode: true, selectedItems: photos, totalCount: 120 });
      expect(label()).toBe("[3/120]");
    } finally {
      await i18n.changeLanguage("en");
      i18n.removeResourceBundle("xx", "translation");
    }
  });
});
