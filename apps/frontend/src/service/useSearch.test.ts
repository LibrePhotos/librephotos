/**
 * Without captioned photos /searchtermexamples/ returns placeholder fragments
 * ("for people", "for things", ...). Shown as Ctrl+K results they read as broken
 * text and search for the phrase itself, so they are not offered; real terms are.
 *
 * The options were copied into state once everything had loaded: a list that failed left the
 * palette without any suggestion and said nothing.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isSearchExample, SearchOptionType, useSearch } from "./useSearch";

const examplesQuery = vi.hoisted(() => ({
  data: ["for things", "for people", "beach"] as string[] | undefined,
  isLoading: false,
}));
const peopleQuery = vi.hoisted(() => ({
  isError: false,
  refetch: vi.fn<() => Promise<unknown>>(async () => undefined),
}));

vi.mock("../api_client/search/hooks/useSearchExamplesQuery", () => ({
  useSearchExamplesQuery: () => ({
    data: examplesQuery.data,
    isLoading: examplesQuery.isLoading,
    isError: false,
    refetch: async () => undefined,
  }),
}));
vi.mock("../api_client/albums/hooks", () => {
  // One array for every render, as a query hands out until it refetches
  const empty: never[] = [];
  const none = () => ({ data: empty, isLoading: false, isError: false, refetch: async () => undefined });
  return {
    useFetchPeopleAlbumsQuery: () =>
      peopleQuery.isError ? { data: undefined, isLoading: false, isError: true, refetch: peopleQuery.refetch } : none(),
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    examplesQuery.data = ["for things", "for people", "beach"];
    examplesQuery.isLoading = false;
    peopleQuery.isError = false;
    peopleQuery.refetch.mockClear();
  });

  async function render() {
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(React.createElement(Probe)));
  }

  async function rerender() {
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

  it("offers the unfiltered options once loading finishes", async () => {
    examplesQuery.isLoading = true;
    examplesQuery.data = undefined;
    await render();
    expect(search.options).toEqual([]);

    examplesQuery.isLoading = false;
    examplesQuery.data = ["for things", "for people", "beach"];
    await rerender();

    expect(examples()).toEqual(["beach"]);
  });

  it("keeps the options for the typed query when the data is refetched", async () => {
    examplesQuery.data = ["for things", "beach", "mountain"];
    await render();
    expect(examples()).toEqual(["beach", "mountain"]);
    await act(async () => search.filterOptions("mount"));
    expect(examples()).toEqual(["mountain"]);

    // A refetch hands out a new array, so a new filterOptions, but loading did not change
    examplesQuery.data = [...examplesQuery.data];
    await rerender();

    expect(examples()).toEqual(["mountain"]);
  });

  it("keeps the other suggestions when one list failed, says so and asks for it again", async () => {
    peopleQuery.isError = true;
    await render();

    expect(examples()).toEqual(["beach"]);
    expect(search.failed).toBe(true);
    search.retry();
    expect(peopleQuery.refetch).toHaveBeenCalledOnce();
  });

  it("follows a refetch that brings new suggestions", async () => {
    await render();
    examplesQuery.data = ["beach", "harbour"];
    await rerender();

    expect(examples()).toEqual(["beach", "harbour"]);
  });
});
