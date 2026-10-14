/**
 * The active search filters as chips (#2259, #329): each chip's remove button hands up the patch
 * that drops only its filter, people chips use the person's name, and Clear all clears.
 */
import type { SearchFilters } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SearchFilterChips } from "./SearchFilterChips";

const stubs = vi.hoisted(() => ({
  peopleSkipped: [] as boolean[],
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: (skip: boolean) => {
    stubs.peopleSkipped.push(skip);
    return {
      data: [
        { id: "3", name: "Anna", video: false, face_count: 12, face_photo_url: "", face_url: "/media/faces/a.jpg" },
      ],
    };
  },
}));

const onChange = vi.fn<(patch: SearchFilters) => void>();
const onClear = vi.fn<() => void>();

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

beforeEach(() => {
  document.body.innerHTML = "";
  onChange.mockReset();
  onClear.mockReset();
  stubs.peopleSkipped = [];
});

async function renderChips(filters: SearchFilters, favoriteRating?: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MantineProvider env="test">
        <SearchFilterChips filters={filters} onChange={onChange} onClear={onClear} favoriteRating={favoriteRating} />
      </MantineProvider>
    );
  });
  return container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    candidate => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name
  );
  return defined(found);
}

describe("SearchFilterChips", () => {
  it("renders nothing without filters and does not load the people", async () => {
    const container = await renderChips({});
    expect(container.querySelector("button")).toBeNull();
    expect(stubs.peopleSkipped).not.toContain(false);
  });

  it("removes one filter with its chip's button", async () => {
    const container = await renderChips({ person: [3], iso_min: 3200, iso_max: 6400, has_location: true });
    expect(container.textContent).toContain("With Anna");
    expect(container.textContent).toContain("ISO 3,200 to 6,400");

    await act(async () => button(container, "Remove filter: ISO 3,200 to 6,400").click());
    expect(onChange).toHaveBeenCalledWith({ iso_min: undefined, iso_max: undefined });

    await act(async () => button(container, "Remove filter: With Anna").click());
    expect(onChange).toHaveBeenLastCalledWith({ person: undefined });
  });

  it("clears every filter with Clear all", async () => {
    const container = await renderChips({ camera: "X-T5" });
    await act(async () => button(container, "Clear all").click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("names the favorite threshold Favorites only", async () => {
    const container = await renderChips({ rating_min: 4 }, 4);
    expect(container.textContent).toContain("Favorites only");
  });
});
