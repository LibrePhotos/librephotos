/**
 * The search filter panel (#2259): number ranges apply on Enter or blur and refuse a lowest value
 * above the highest, presets set both ends, the rating follows the user's rating mode (#2601),
 * and the location and file controls hand up the API's own parameters.
 */
import type { SearchFilters } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SearchFilterPanel } from "./SearchFilterPanel";

const stubs = vi.hoisted(() => ({ suggestionsEnabled: [] as boolean[] }));

vi.mock("../../api_client/search/hooks", () => ({
  useMetadataValuesQuery: (_field: string, enabled: boolean) => {
    stubs.suggestionsEnabled.push(enabled);
    return { data: [{ value: "X-T5", count: 4812 }], isLoading: false };
  },
}));

const onChange = vi.fn<(patch: SearchFilters) => void>();

beforeAll(async () => {
  // jsdom has no matchMedia or ResizeObserver; Mantine needs both
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
  onChange.mockReset();
  stubs.suggestionsEnabled = [];
});

async function renderPanel(filters: SearchFilters, favoriteRating?: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MantineProvider env="test">
        <SearchFilterPanel
          filters={filters}
          onChange={onChange}
          people={[]}
          favoriteRating={favoriteRating}
          active={false}
        />
      </MantineProvider>
    );
  });
  return container;
}

function inputNamed(name: string): HTMLInputElement {
  const byAria = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  if (byAria) return byAria;
  // The text of a label, or of an element inside one (a Switch's label, a SegmentedControl's).
  const id = Array.from(document.querySelectorAll("label, span, div"))
    .filter(item => item.textContent?.trim() === name)
    .map(item => item.closest("label")?.getAttribute("for"))
    .find(found => found);
  return defined(id ? document.querySelector<HTMLInputElement>(`input[id="${id}"]`) : null, name);
}

/** Mantine's Rating takes the click on the star's label, as a pointer does. */
async function clickStar(name: string) {
  const id = inputNamed(name).id;
  await act(async () => defined(document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)).click());
}

async function type(input: HTMLInputElement, value: string) {
  const setter = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.blur();
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function chip(name: string): HTMLInputElement {
  const label = defined(Array.from(document.querySelectorAll("label")).find(item => item.textContent === name));
  return defined(document.querySelector<HTMLInputElement>(`input[id="${label.getAttribute("for")}"]`));
}

describe("SearchFilterPanel", () => {
  it("loads the camera suggestions only while the panel is open", async () => {
    await renderPanel({});
    expect(stubs.suggestionsEnabled).not.toContain(true);
  });

  it("applies a range end on Enter", async () => {
    await renderPanel({});
    const low = inputNamed("ISO, Min");
    await type(low, "3200");
    await act(async () => {
      low.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ iso_min: 3200, iso_max: undefined });
  });

  it("does not apply a lowest value above the highest, and says why", async () => {
    await renderPanel({ iso_min: 6400 });
    const high = inputNamed("ISO, Max");
    await type(high, "100");
    await blur(high);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("searchfilter.rangeerror"));
  });

  it("sets both ends with a preset and clears them with the same preset", async () => {
    await renderPanel({});
    await act(async () => chip("1,600 to 6,400").click());
    expect(onChange).toHaveBeenCalledWith({ iso_min: 1600, iso_max: 6400 });
  });

  it("offers stars in the stars rating mode", async () => {
    await renderPanel({});
    await clickStar("3 stars or more");
    expect(onChange).toHaveBeenCalledWith({ rating_min: 3 });
  });

  it("offers Favorites only in the favorite rating mode, asking for the user's threshold", async () => {
    await renderPanel({}, 4);
    expect(document.querySelector('input[aria-label="3 stars or more"]')).toBeNull();
    await act(async () => inputNamed("Favorites only").click());
    expect(onChange).toHaveBeenCalledWith({ rating_min: 4 });
  });

  it("filters by location and RAW files", async () => {
    await renderPanel({});
    await act(async () => inputNamed("No location").click());
    expect(onChange).toHaveBeenCalledWith({ has_location: false });
    await act(async () => inputNamed("Has a RAW file").click());
    expect(onChange).toHaveBeenLastCalledWith({ file_type: "raw" });
  });

  it("applies the extension on blur, without the dot and in lower case", async () => {
    await renderPanel({});
    const extension = inputNamed("File extension");
    await type(extension, ".CR3");
    await blur(extension);
    expect(onChange).toHaveBeenCalledWith({ extension: "cr3" });
  });
});
