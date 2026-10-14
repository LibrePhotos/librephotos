/**
 * The search page's Filters button (#2259): it names how many filters are active, opens the panel
 * in a popover on a desktop and in a bottom sheet on a phone (with Show N photos), loads the
 * people only once open, and offers Clear all only while something filters.
 */
import type { SearchFilters } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SearchFilterButton } from "./SearchFilterButton";

const stubs = vi.hoisted(() => ({ phone: false, peopleSkipped: [] as boolean[], panelActive: [] as boolean[] }));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: (skip: boolean) => {
    stubs.peopleSkipped.push(skip);
    return { data: [] };
  },
}));
// The panel has its own tests; here it only says whether it is told it is open.
vi.mock("./SearchFilterPanel", () => ({
  SearchFilterPanel: ({ active }: { active: boolean }) => {
    stubs.panelActive.push(active);
    return <div data-testid="panel" />;
  },
}));

const onChange = vi.fn<(patch: SearchFilters) => void>();
const onClear = vi.fn<() => void>();

beforeAll(async () => {
  window.matchMedia = (query: string): MediaQueryList => ({
    // The phone breakpoint query is a max-width one
    matches: stubs.phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // jsdom has no ResizeObserver; the popover and the scroll area need it
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
  onClear.mockReset();
  stubs.peopleSkipped = [];
  stubs.panelActive = [];
});

async function renderButton(filters: SearchFilters) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MantineProvider env="test">
        <SearchFilterButton
          filters={filters}
          onChange={onChange}
          onClear={onClear}
          favoriteRating={undefined}
          resultCount={5}
        />
      </MantineProvider>
    );
  });
}

function button(name: string | RegExp): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(candidate => {
    const label = candidate.getAttribute("aria-label") ?? candidate.textContent?.trim() ?? "";
    return typeof name === "string" ? label === name : name.test(label);
  });
  return defined(found, String(name));
}

describe("SearchFilterButton", () => {
  it("opens the panel in a popover on a desktop, with Clear all while something filters", async () => {
    stubs.phone = false;
    await renderButton({ camera: "X-T5", iso_min: 400, iso_max: 800 });
    expect(stubs.peopleSkipped).not.toContain(false);
    expect(defined(document.querySelector('[aria-label="2 filters active"]')).textContent).toBe("2");

    await act(async () => button(/^Filters/).click());
    expect(document.querySelector('[data-testid="panel"]')).not.toBeNull();
    expect(stubs.panelActive.at(-1)).toBe(true);
    expect(stubs.peopleSkipped.at(-1)).toBe(false);

    await act(async () => button("Clear all").click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("offers no Clear all without filters", async () => {
    stubs.phone = false;
    await renderButton({});
    await act(async () => button("Filters").click());
    expect(Array.from(document.body.querySelectorAll("button")).map(item => item.textContent)).not.toContain(
      "Clear all"
    );
  });

  it("opens a bottom sheet on a phone, closed by Show N photos", async () => {
    stubs.phone = true;
    await renderButton({ person: [3, 7] });

    await act(async () => button("Filters, 2 filters active").click());
    expect(document.body.textContent).toContain("Search filters");
    expect(document.querySelector('[data-testid="panel"]')).not.toBeNull();

    await act(async () => button("Show 5 photos").click());
    expect(document.querySelector('[data-testid="panel"]')).toBeNull();
  });
});
