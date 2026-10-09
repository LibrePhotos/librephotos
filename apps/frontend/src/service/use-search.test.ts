/**
 * Without captioned photos /searchtermexamples/ returns placeholder fragments
 * ("for people", "for things", ...). Shown as Ctrl+K results they read as broken
 * text and search for the phrase itself, so they are not offered; real terms are.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isSearchExample, SearchOptionType, useSearch } from "./use-search";

vi.mock("../api_client/search/hooks/useSearchExamplesQuery", () => ({
  useSearchExamplesQuery: () => ({ data: ["for things", "for people", "beach"], isLoading: false }),
}));
vi.mock("../api_client/albums/hooks", () => {
  const none = () => ({ data: [], isLoading: false });
  return {
    useFetchPeopleAlbumsQuery: none,
    useFetchPlacesAlbumsQuery: none,
    useFetchThingsAlbumsQuery: none,
    useFetchUserAlbumsQuery: none,
  };
});

describe("isSearchExample", () => {
  it.each(["for people", "for places", "for things", "for time", "for file path or file name"])(
    "drops the placeholder fragment %j",
    fragment => {
      expect(isSearchExample(fragment)).toBe(false);
    }
  );

  it.each(["beach", "for sale sign", "Lisbon"])("keeps the search term %j", term => {
    expect(isSearchExample(term)).toBe(true);
  });
});

describe("useSearch", () => {
  let search: ReturnType<typeof useSearch>;
  let root: ReturnType<typeof createRoot>;

  function Probe() {
    search = useSearch();
    return null;
  }

  const examples = () => search.options.filter(o => o.type === SearchOptionType.EXAMPLE).map(o => o.value);

  beforeAll(() => {
    // @ts-ignore
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function render() {
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(React.createElement(Probe)));
  }

  // The placeholders come first, so cutting the list to two before dropping them left none
  it("offers the real terms, not the placeholders, before anything is typed", async () => {
    await render();

    expect(examples()).toEqual(["beach"]);
  });

  it("does not offer a placeholder that matches the query", async () => {
    await render();
    await act(async () => search.filterOptions("for"));

    expect(examples()).toEqual([]);
  });
});
