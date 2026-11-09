import { faceKeys } from "@librephotos/api-client";
import type { IncompletePersonFace, IncompletePersonFaceListRequest } from "@librephotos/api-client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFaceEdits,
  fetchIncompletePeople,
  mergeLoadedFaces,
  withoutFaces,
  withPlaceholders,
} from "./faceListCache";
import type { CompletePersonFaceList, PersonFace } from "./types";

const stubs = vi.hoisted(() => ({
  fetchIncompleteFaces: vi.fn<() => Promise<IncompletePersonFace[]>>(),
}));

vi.mock("@librephotos/api-client", async importOriginal => {
  const actual = await importOriginal<typeof import("@librephotos/api-client")>();
  return { ...actual, endpoints: { ...actual.endpoints, fetchIncompleteFaces: stubs.fetchIncompleteFaces } };
});

const person = (id: number, faceCount: number, name = `Person ${id}`): IncompletePersonFace => ({
  id,
  name,
  kind: "USER",
  face_count: faceCount,
  similarity_rank: null,
});

const loaded = (id: number, personId: number): PersonFace => ({
  id,
  image: "img",
  face_url: `/faces/${id}.jpg`,
  photo: `photo-${id}`,
  person_label_probability: 1,
  person: personId,
});

/** Person 1 with its first `loadedCount` faces paged in (ids 1001, 1002, ...). */
const partlyLoaded = (faceCount: number, loadedCount: number): CompletePersonFaceList => {
  const [entry] = withPlaceholders([person(1, faceCount)]);
  if (!entry) throw new Error("no person");
  return [
    { ...entry, faces: entry.faces.map((face, index) => (index < loadedCount ? loaded(1001 + index, 1) : face)) },
  ];
};

describe("withoutFaces", () => {
  it("drops the edited faces and gives the placeholders after them their new index", () => {
    const people = partlyLoaded(5, 3);

    const [next] = withoutFaces(people, new Set([1002]));

    expect(next?.face_count).toBe(4);
    expect(next?.faces.map(face => [face.id, face.isTemp ?? false])).toEqual([
      [1001, false],
      [1003, false],
      [2, true],
      [3, true],
    ]);
  });

  it("drops a person left without faces", () => {
    const people = [...partlyLoaded(1, 1), ...withPlaceholders([person(2, 3)])];

    expect(withoutFaces(people, new Set([1001])).map(entry => entry.id)).toEqual([2]);
  });

  it("answers the same list when no face of it was edited", () => {
    const people = partlyLoaded(5, 3);

    // A placeholder's index is not a face id
    expect(withoutFaces(people, new Set([0, 4, 9999]))).toBe(people);
  });
});

describe("mergeLoadedFaces", () => {
  it("answers the cached list when the server counts what the cache holds", () => {
    const cached = partlyLoaded(5, 3);

    expect(mergeLoadedFaces([person(1, 5)], cached)).toBe(cached);
  });

  it("keeps the loaded faces of a person whose count is unchanged, and starts over where it moved", () => {
    const cached = [...partlyLoaded(5, 3), ...withPlaceholders([person(2, 2)])];

    const merged = mergeLoadedFaces([person(1, 5, "Renamed"), person(2, 3), person(3, 1)], cached);

    expect(merged.map(entry => entry.name)).toEqual(["Renamed", "Person 2", "Person 3"]);
    expect(merged[0]?.faces).toBe(cached[0]?.faces);
    expect(merged[1]?.faces).toHaveLength(3);
    expect(merged[1]?.faces.every(face => face.isTemp)).toBe(true);
    expect(merged[2]?.faces).toHaveLength(1);
  });
});

describe("applyFaceEdits", () => {
  const request: IncompletePersonFaceListRequest = { inferred: false, orderBy: "date" };
  const queryKey = faceKeys.incompleteList(request);
  let client: QueryClient;
  let unsubscribe: () => void;

  const cached = () => client.getQueryData<CompletePersonFaceList>(queryKey);

  beforeEach(async () => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    stubs.fetchIncompleteFaces.mockReset();
    stubs.fetchIncompleteFaces.mockResolvedValue([person(1, 250)]);
    // A dashboard watching the list, as useFetchIncompleteFacesQuery does
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => withPlaceholders(await fetchIncompletePeople(request)),
    });
    unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(cached()).toBeDefined());
    client.setQueryData<CompletePersonFaceList>(queryKey, partlyLoaded(250, 100));
    stubs.fetchIncompleteFaces.mockClear();
  });

  afterEach(() => {
    unsubscribe();
    client.clear();
    vi.useRealTimers();
  });

  it("takes the faces out of the list at once, without refetching it", () => {
    applyFaceEdits(client, [1005]);

    expect(cached()?.[0]?.face_count).toBe(249);
    expect(cached()?.[0]?.faces.some(face => face.id === 1005 && !face.isTemp)).toBe(false);
    expect(stubs.fetchIncompleteFaces).not.toHaveBeenCalled();
  });

  it("asks for the counts once after a burst of edits, and keeps the faces already loaded", async () => {
    stubs.fetchIncompleteFaces.mockResolvedValue([person(1, 247)]);

    applyFaceEdits(client, [1001]);
    await vi.advanceTimersByTimeAsync(100);
    applyFaceEdits(client, [1002]);
    await vi.advanceTimersByTimeAsync(100);
    applyFaceEdits(client, [1003]);
    const afterEdits = cached();
    await vi.advanceTimersByTimeAsync(2000);

    expect(stubs.fetchIncompleteFaces).toHaveBeenCalledTimes(1);
    expect(cached()).toBe(afterEdits);
    expect(cached()?.[0]?.faces[0]?.id).toBe(1004);
  });

  it("drops a refresh that a newer edit overtook", async () => {
    let answer: (people: IncompletePersonFace[]) => void = () => {};
    stubs.fetchIncompleteFaces.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
    stubs.fetchIncompleteFaces.mockResolvedValue([person(1, 248)]);

    applyFaceEdits(client, [1001]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(stubs.fetchIncompleteFaces).toHaveBeenCalledTimes(1);

    applyFaceEdits(client, [1002]);
    // The server answers what it counted before the second edit: the face would come back
    answer([person(1, 249)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(cached()?.[0]?.face_count).toBe(248);

    await vi.advanceTimersByTimeAsync(1100);
    expect(stubs.fetchIncompleteFaces).toHaveBeenCalledTimes(2);
    expect(cached()?.[0]?.face_count).toBe(248);
    expect(cached()?.[0]?.faces[0]?.id).toBe(1003);
  });
});
