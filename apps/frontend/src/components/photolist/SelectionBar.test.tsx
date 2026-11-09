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
import type { ListSelection } from "./photoListSelection";
import { SelectionBar } from "./SelectionBar";

type SelectionBarProps = React.ComponentProps<typeof SelectionBar>;

const picked = (items: PigPhoto[]): ListSelection => ({ kind: "some", items, keepOpen: false });
const all = (excluded: PigPhoto[]): ListSelection => ({ kind: "all", query: { favorite: true }, excluded });

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
          selection={{ kind: "some", items: [], keepOpen: true }}
          dispatch={() => {}}
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
    const dispatch = vi.fn<SelectionBarProps["dispatch"]>();
    const button = await render({ dispatch });

    expect(button.getAttribute("aria-label")).toBe("Select all");
    await act(async () => button.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "selectLoaded", items: [] });
  });

  it("selects all by the list's query, and Deselect all keeps select mode open", async () => {
    const dispatch = vi.fn<SelectionBarProps["dispatch"]>();
    const button = await render({ dispatch, photosetQuery: { favorite: true }, totalCount: 40 });
    await act(async () => button.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "selectAll", query: { favorite: true } });

    const all = await render({
      dispatch,
      selection: { kind: "all", query: { favorite: true }, excluded: [] },
      totalCount: 40,
    });
    expect(all.getAttribute("aria-label")).toBe("Deselect all");
    await act(async () => all.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "deselectAll" });
  });

  it("offers Deselect all once every loaded item is selected", async () => {
    const items = [1, 2].map(n =>
      PigPhoto.parse({ id: `00000000-0000-4000-8000-00000000000${n}`, image_hash: `hash-${n}`, aspectRatio: 1 })
    );
    const button = await render({ idx2hash: items, selection: picked(items) });

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
    const dispatch = vi.fn<SelectionBarProps["dispatch"]>();
    const button = await render({ idx2hash, totalCount: 5, dispatch });

    expect(button.getAttribute("aria-label")).toBe("Select the loaded photos");
    await act(async () => button.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "selectLoaded", items: idx2hash });
  });

  it("counts the selection against the total, not as all", async () => {
    await render({ idx2hash, totalCount: 5, selection: picked(loaded) });

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
  // The count beside Select all, announced as it changes
  const label = () => defined(container?.querySelector('[aria-live="polite"]')).textContent;

  it("counts a manual selection", async () => {
    await render({ idx2hash: photos, selection: picked(photos.slice(0, 2)), totalCount: 3 });
    expect(label()).toContain("2 selected");
  });

  it("names the whole set after Select all, grouping the digits", async () => {
    await render({ selection: all([]), totalCount: 25123 });
    expect(label()).toContain("All 25,123 selected");
  });

  it("says how many photos were taken out of Select all again", async () => {
    await render({ selection: all(photos), totalCount: 120 });
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
      await render({ idx2hash: photos, selection: picked(photos.slice(0, 2)), totalCount: 3 });
      expect(label()).toBe("[2]");
      await render({ selection: all([]), totalCount: 120 });
      expect(label()).toBe("[*120]");
      await render({ selection: all(photos), totalCount: 120 });
      expect(label()).toBe("[3/120]");
    } finally {
      await i18n.changeLanguage("en");
      i18n.removeResourceBundle("xx", "translation");
    }
  });
});
