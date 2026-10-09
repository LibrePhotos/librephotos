/**
 * /folders/subfolders/ pages by 100 directory entries. The Folders page and the
 * albums overview read only the first page, so a library with more top-level
 * folders than that never showed the rest, and counted at most 100.
 */
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useAllFolderSubfolders } from "./useFetchFolderSubfoldersInfiniteQuery";

const stubs = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`API error: ${status}`);
    }
  }
  return { ApiError, get: vi.fn() };
});

vi.mock("../../api", () => ({ ApiError: stubs.ApiError, fetchClient: { get: stubs.get } }));

function folderPage(page: number, names: string[], hasNext: boolean) {
  return {
    current_path: "/data",
    parent_path: null,
    subfolders: names.map(name => ({ name, path: `/data/${name}`, photo_count: 1, modified: 0 })),
    pagination: { page, page_size: 100, total_folders: 0, total_pages: 3, has_next: hasNext, has_previous: page > 1 },
  };
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
let result: ReturnType<typeof useAllFolderSubfolders>;

function Probe() {
  result = useAllFolderSubfolders();
  return null;
}

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  stubs.get.mockReset();
});

async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
}

// Lets the queries answer, up to a second, until `done` holds
async function settle(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
}

describe("useAllFolderSubfolders", () => {
  it("collects every page, also past an empty one", async () => {
    stubs.get.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      // The server drops folders without photos after paging, so a page can be empty
      if (page === 1) return folderPage(1, ["a", "b"], true);
      if (page === 2) return folderPage(2, [], true);
      return folderPage(3, ["c"], false);
    });

    await mount();
    await settle(() => !result.isFetching);

    expect(result.subfolders.map(folder => folder.name)).toEqual(["a", "b", "c"]);
    expect(result.isFetching).toBe(false);
    expect(stubs.get).toHaveBeenCalledTimes(3);
  });

  it("is still loading while only an empty page is in and more follow", async () => {
    let answerPage2: (page: unknown) => void = () => {};
    stubs.get.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 1) return folderPage(1, [], true);
      return new Promise(resolve => {
        answerPage2 = resolve;
      });
    });

    await mount();
    await settle(() => stubs.get.mock.calls.length === 2);

    // The Folders page and the overview card read this to hold back "no folders"
    expect(result.subfolders).toEqual([]);
    expect(result.isLoading).toBe(true);

    await act(async () => answerPage2(folderPage(2, ["c"], false)));
    await settle(() => !result.isFetching);

    expect(result.subfolders.map(folder => folder.name)).toEqual(["c"]);
    expect(result.isLoading).toBe(false);
  });

  it("does not reload every page on window focus", async () => {
    stubs.get.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      return page === 1 ? folderPage(1, ["a"], true) : folderPage(2, ["b"], false);
    });

    await mount();
    await settle(() => !result.isFetching);
    expect(stubs.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(() => stubs.get.mock.calls.length > 2);
    focusManager.setFocused(undefined);

    expect(stubs.get).toHaveBeenCalledTimes(2);
  });

  it("asks once when the server refuses (a folder outside the scan directory)", async () => {
    stubs.get.mockRejectedValue(new stubs.ApiError(403));

    await mount();
    await settle(() => !result.isLoading);

    expect(result.subfolders).toEqual([]);
    expect(result.isLoading).toBe(false);
    expect(stubs.get).toHaveBeenCalledTimes(1);
  });
});
