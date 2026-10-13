/**
 * The folder page's subfolder strip (and its "+N more" count) read only the
 * first page of /folders/subfolders/, which pages by 100 directory entries: a
 * folder with more subfolders than that silently lost the rest.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { useFetchFolderSubfoldersQuery } from "./useFetchFolderAlbumsQuery";

const stubs = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`API error: ${status}`);
    }
  }
  return { ApiError, get: vi.fn<(endpoint: string) => Promise<unknown>>() };
});

vi.mock("../../api", () => ({ ApiError: stubs.ApiError, apiClient: { get: stubs.get } }));

const PARENT = "/data/photos";
const FOLDER = "/data/photos/2024";

function folderPage(page: number, names: string[], hasNext: boolean) {
  return {
    current_path: FOLDER,
    parent_path: PARENT,
    results: names.map(name => ({ name, path: `${FOLDER}/${name}`, photo_count: 1, modified: 0 })),
    count: 101,
    // The server's own host and the path it was asked for; only the query counts
    next: hasNext
      ? `http://backend:8001/api/folders/subfolders/?page=${page + 1}&path=${encodeURIComponent(FOLDER)}`
      : null,
    previous: page > 1 ? "http://backend:8001/api/folders/subfolders/" : null,
    page,
    page_size: 100,
    num_pages: 2,
  };
}

const firstHundred = Array.from({ length: 100 }, (_, i) => `day-${String(i + 1).padStart(3, "0")}`);

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
let result: ReturnType<typeof useFetchFolderSubfoldersQuery>;

function Probe() {
  result = useFetchFolderSubfoldersQuery(FOLDER);
  return null;
}

beforeAll(() => {
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
    defined(root).render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
}

// Lets the query answer, up to a second, until `done` holds
async function settle(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
}

describe("useFetchFolderSubfoldersQuery", () => {
  it("reads every page of a folder's subfolders, past the first 100", async () => {
    stubs.get.mockImplementation(async (url: string) => {
      const page = new URLSearchParams(url.split("?")[1]).get("page");
      return page === "2" ? folderPage(2, ["day-101"], false) : folderPage(1, firstHundred, true);
    });

    await mount();
    await settle(() => result.isSuccess);

    const names = defined(result.data).results.map(folder => folder.name);
    expect(names).toHaveLength(101);
    expect(names.at(-1)).toBe("day-101");
    // The back button still gets the folder's parent from the first page
    expect(result.data?.parent_path).toBe(PARENT);
    expect(stubs.get.mock.calls.map(([url]) => url)).toEqual([
      `/folders/subfolders/?path=${encodeURIComponent(FOLDER)}`,
      `/folders/subfolders/?page=2&path=${encodeURIComponent(FOLDER)}`,
    ]);
  });

  it("asks once when the server refuses (a folder outside the scan directory)", async () => {
    stubs.get.mockRejectedValue(new stubs.ApiError(403));

    await mount();
    await settle(() => result.isError);

    expect(result.isError).toBe(true);
    expect(stubs.get).toHaveBeenCalledTimes(1);
  });
});
