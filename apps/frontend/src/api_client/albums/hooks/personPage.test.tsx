/**
 * The person page's data (#2207): the person by id (null for a 404, so the page can say "Person
 * not found"), taking the person off photos, which refreshes the person's grid, the people list
 * and the face lists once the server answered, and merging two people (#2206), which refreshes
 * the same. The people list and the person carry the birth date (#2750), and setting it refreshes
 * both.
 */
import { albumKeys, faceKeys, photoGridKeys, Photoset } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { useFetchPeopleAlbumsQuery } from "./useFetchPeopleAlbumsQuery";
import { useFetchPersonQuery } from "./useFetchPersonQuery";
import { useMergePersonMutation } from "./useMergePersonMutation";
import { useRemovePhotosFromPersonMutation } from "./useRemovePhotosFromPersonMutation";
import { useSetPersonBirthDateMutation } from "./useSetPersonBirthDateMutation";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  personBirthDate: vi.fn<(name: string, saved: boolean) => void>(),
  removePhotosFromPerson: vi.fn<(name: string, count: number) => void>(),
  faceTagsNotWritten: vi.fn<(error: string) => void>(),
  mergePerson: vi.fn<(sourceName: string, targetName: string) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: {
    get: (...args: Parameters<typeof stubs.get>) => stubs.get(...args),
    post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args),
    patch: (...args: Parameters<typeof stubs.patch>) => stubs.patch(...args),
  },
}));
vi.mock("../../../service/notifications", () => ({
  notification: {
    removePhotosFromPerson: stubs.removePhotosFromPerson,
    faceTagsNotWritten: stubs.faceTagsNotWritten,
    mergePerson: stubs.mergePerson,
    personBirthDate: stubs.personBirthDate,
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

describe("the birth date (#2750)", () => {
  const row = { name: "Anna", face_url: "/f", face_count: 3, face_photo_url: "hash", video: false, id: 5 };

  it("is in the people list, null for a person without one or from an older server", async () => {
    stubs.get.mockResolvedValue({
      results: [
        { ...row, birth_date: "2019-05-03" },
        { ...row, id: 6, name: "Ben" },
      ],
    });
    const seen: { result?: ReturnType<typeof useFetchPeopleAlbumsQuery> } = {};
    function Harness() {
      seen.result = useFetchPeopleAlbumsQuery();
      return null;
    }

    const root = await mount(Harness);
    await act(async () => {
      await vi.waitFor(() => expect(seen.result?.isPending).toBe(false));
    });
    await act(async () => root.unmount());

    expect(seen.result?.data?.map(person => [person.name, person.birth_date])).toEqual([
      ["Anna", "2019-05-03"],
      ["Ben", null],
    ]);
  });

  it("is set with a PATCH, says so and refreshes the people and the person", async () => {
    stubs.patch.mockResolvedValue({ ...row, birth_date: "2019-05-03" });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const seen: { mutation?: ReturnType<typeof useSetPersonBirthDateMutation> } = {};
    function Harness() {
      seen.mutation = useSetPersonBirthDateMutation();
      return null;
    }
    const root = await mount(Harness);

    await act(async () => {
      await seen.mutation?.mutateAsync({ id: "5", name: "Anna", birthDate: "2019-05-03" });
    });
    await act(async () => root.unmount());

    expect(stubs.patch).toHaveBeenCalledWith("/persons/5/", { birth_date: "2019-05-03" });
    expect(stubs.personBirthDate).toHaveBeenCalledWith("Anna", true);
    // The person is under the people list's key
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([albumKeys.peopleAlbums()]);
  });
});

describe("useFetchPersonQuery", () => {
  it("reads the person as the people list shapes it", async () => {
    stubs.get.mockResolvedValue({
      name: "Anna",
      face_url: null,
      face_count: 3,
      face_photo_url: "hash",
      video: false,
      id: 5,
      group_ids: [2],
      birth_date: "2019-05-03",
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
      group_ids: [2],
      birth_date: "2019-05-03",
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

describe("useMergePersonMutation", () => {
  it("merges, says so and refreshes what the merged faces moved between", async () => {
    stubs.post.mockResolvedValue({ moved: 4, photo_count: 3, write_queued: false });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let mutate: ReturnType<typeof useMergePersonMutation>["mutateAsync"] | undefined;
    function Harness() {
      mutate = useMergePersonMutation().mutateAsync;
      return null;
    }
    const root = await mount(Harness);
    await act(async () => {
      await mutate?.({ targetId: "5", targetName: "Robert", sourceId: "9", sourceName: "Bob" });
    });
    await act(async () => root.unmount());

    expect(stubs.post).toHaveBeenCalledWith("/persons/5/merge/", { person: 9 });
    expect(stubs.mergePerson).toHaveBeenCalledWith("Bob", "Robert");
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([
        photoGridKeys.dateAlbumLists(Photoset.PERSON),
        albumKeys.peopleAlbums(),
        faceKeys.personFaces(),
        faceKeys.incomplete(),
      ])
    );
  });

  it("says nothing when the merge fails", async () => {
    stubs.post.mockRejectedValue(new ApiError("Not found", 404));
    let mutate: ReturnType<typeof useMergePersonMutation>["mutateAsync"] | undefined;
    function Harness() {
      mutate = useMergePersonMutation().mutateAsync;
      return null;
    }
    const root = await mount(Harness);
    await act(async () => {
      await expect(
        mutate?.({ targetId: "5", targetName: "Robert", sourceId: "9", sourceName: "Bob" })
      ).rejects.toBeInstanceOf(ApiError);
    });
    await act(async () => root.unmount());

    expect(stubs.mergePerson).not.toHaveBeenCalled();
  });
});
