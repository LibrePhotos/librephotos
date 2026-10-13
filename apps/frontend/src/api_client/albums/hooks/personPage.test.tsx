/**
 * The person page's data (#2207): the person by id (null for a 404, so the page can say "Person
 * not found"), and taking the person off photos, which refreshes the person's grid, the people
 * list and the face lists once the server answered.
 */
import { albumKeys, faceKeys, photoGridKeys, Photoset } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { useFetchPersonQuery } from "./useFetchPersonQuery";
import { useRemovePhotosFromPersonMutation } from "./useRemovePhotosFromPersonMutation";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  removePhotosFromPerson: vi.fn<(name: string, count: number) => void>(),
  faceTagsNotWritten: vi.fn<(error: string) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: {
    get: (...args: Parameters<typeof stubs.get>) => stubs.get(...args),
    post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args),
  },
}));
vi.mock("../../../service/notifications", () => ({
  notification: {
    removePhotosFromPerson: stubs.removePhotosFromPerson,
    faceTagsNotWritten: stubs.faceTagsNotWritten,
  },
}));

let client: QueryClient;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

async function mount(Harness: React.ComponentType) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  return root;
}

async function fetchPerson(id: number) {
  const seen: { result?: ReturnType<typeof useFetchPersonQuery> } = {};
  function Harness() {
    seen.result = useFetchPersonQuery(id);
    return null;
  }
  const root = await mount(Harness);
  // A disabled query never settles; an enabled one settles on its answer
  if (Number.isInteger(id)) {
    await act(async () => {
      await vi.waitFor(() => expect(seen.result?.isPending).toBe(false));
    });
  }
  await act(async () => root.unmount());
  return seen.result;
}

describe("useFetchPersonQuery", () => {
  it("reads the person as the people list shapes it", async () => {
    stubs.get.mockResolvedValue({
      name: "Anna",
      face_url: null,
      face_count: 3,
      face_photo_url: "hash",
      video: false,
      id: 5,
    });

    const result = await fetchPerson(5);

    expect(stubs.get).toHaveBeenCalledWith("/persons/5/");
    expect(result?.data).toEqual({
      id: "5",
      name: "Anna",
      video: false,
      face_count: 3,
      face_photo_url: "hash",
      face_url: "",
    });
  });

  it("answers null for an unknown person", async () => {
    stubs.get.mockRejectedValue(new ApiError("Not found", 404));

    expect((await fetchPerson(5))?.data).toBeNull();
  });

  it("does not hide another failure", async () => {
    stubs.get.mockRejectedValue(new ApiError("Forbidden", 403));

    expect((await fetchPerson(5))?.isError).toBe(true);
  });

  it("does not ask for an id that is no person's", async () => {
    await fetchPerson(Number.NaN);

    expect(stubs.get).not.toHaveBeenCalled();
  });
});

describe("useRemovePhotosFromPersonMutation", () => {
  async function remove(answer: unknown) {
    stubs.post.mockResolvedValue(answer);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let mutate: ReturnType<typeof useRemovePhotosFromPersonMutation>["mutateAsync"] | undefined;
    function Harness() {
      mutate = useRemovePhotosFromPersonMutation().mutateAsync;
      return null;
    }
    const root = await mount(Harness);
    await act(async () => {
      await mutate?.({ personId: "5", personName: "Anna", photoIds: ["p1", "p2"] });
    });
    await act(async () => root.unmount());
    return invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  }

  it("confirms and refreshes what the photos left", async () => {
    const refreshed = await remove({ removed: 2, photo_count: 2, write_error: null });

    expect(stubs.post).toHaveBeenCalledWith("/persons/5/remove-photos/", { photo_ids: ["p1", "p2"] });
    expect(stubs.removePhotosFromPerson).toHaveBeenCalledWith("Anna", 2);
    expect(stubs.faceTagsNotWritten).not.toHaveBeenCalled();
    expect(refreshed).toEqual(
      expect.arrayContaining([
        photoGridKeys.dateAlbumLists(Photoset.PERSON),
        albumKeys.peopleAlbums(),
        faceKeys.incomplete(),
      ])
    );
  });

  it("says so when the face tags did not reach the files", async () => {
    await remove({ removed: 2, photo_count: 2, write_error: "1 of 2 photos were not written: read-only" });

    expect(stubs.faceTagsNotWritten).toHaveBeenCalledWith("1 of 2 photos were not written: read-only");
  });
});
