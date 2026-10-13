import type { IncompletePersonFaceListRequest, PersonFaceListRequest } from "@librephotos/api-client";
import { faceKeys } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../../api_client/api";
import type { CompletePersonFaceList, PersonFaceList } from "../../../api_client/faces";
import { defined } from "../../../util/defined.test-utils";
import { FacesTab, type FacesPersonOrder } from "../facesTab";
import { useFaceDataFetching } from "./useFaceDataFetching";

// The part of useFetchIncompleteFacesQuery's result the hook reads
type IncompleteFacesResult = { data: CompletePersonFaceList | undefined; isFetching: boolean };

const stubs = vi.hoisted(() => ({
  fetchFaces: vi.fn<(params: PersonFaceListRequest) => Promise<PersonFaceList>>(),
  incomplete: vi.fn<(request: IncompletePersonFaceListRequest) => IncompleteFacesResult>(),
}));

vi.mock("../../../api_client/faces", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../api_client/faces")>();
  return {
    ...actual,
    fetchFaces: stubs.fetchFaces,
    useFetchIncompleteFacesQuery: stubs.incomplete,
  };
});

const PERSON_ID = 42;
const INFERRED_PARAMS: IncompletePersonFaceListRequest = {
  inferred: true,
  method: "clustering",
  orderBy: "confidence",
  minConfidence: 0,
};
const INFERRED_KEY = faceKeys.incompleteList(INFERRED_PARAMS);

type Group = { page: number; person: number; inferred: boolean; method: "clustering" };

const page = (n: number): Group => ({ page: n, person: PERSON_ID, inferred: true, method: "clustering" });

const placeholders = (count: number): PersonFaceList =>
  Array.from({ length: count }, (_, id) => ({
    id,
    image: null,
    face_url: null,
    photo: "",
    person_label_probability: 1,
    person: PERSON_ID,
    isTemp: true,
  }));

let isFetchingLists = false;

/** Seed the incomplete-faces cache the way a fresh list response would. */
const seedPerson = (faceCount: number) => {
  queryClient.setQueryData<CompletePersonFaceList>(INFERRED_KEY, [
    { id: PERSON_ID, name: "Unknown 7", face_count: faceCount, kind: "CLUSTER", faces: placeholders(faceCount) },
  ]);
};

/** The first face of the seeded person, as the cache holds it now. */
const firstCachedFace = () => {
  const people = queryClient.getQueryData<CompletePersonFaceList>(INFERRED_KEY);
  if (!people?.length) throw new Error("no person in the incomplete-faces cache");
  return defined(people[0]?.faces[0], "the first cached face");
};

let root: Root;
let container: HTMLDivElement;

let lists: ReturnType<typeof useFaceDataFetching>["lists"] | undefined;

function Harness({ groups, personOrder }: { groups: Group[]; personOrder: FacesPersonOrder }) {
  lists = useFaceDataFetching(groups, FacesTab.enum.inferred, "clustering", "confidence", 0, personOrder).lists;
  return null;
}

const render = async (groups: Group[], personOrder: FacesPersonOrder = "name") => {
  await act(async () => {
    root.render(<Harness groups={groups} personOrder={personOrder} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  // Tells React that act() is in charge of flushing here
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isFetchingLists = false;
  stubs.incomplete.mockImplementation(request =>
    request.inferred
      ? { data: queryClient.getQueryData<CompletePersonFaceList>(INFERRED_KEY), isFetching: isFetchingLists }
      : { data: [], isFetching: isFetchingLists }
  );
  stubs.fetchFaces.mockReset();
  stubs.fetchFaces.mockImplementation(({ page: requested }) =>
    Promise.resolve(
      Array.from({ length: 100 }, (_, i) => ({
        id: (requested - 1) * 100 + i + 1000,
        image: "img",
        face_url: "url",
        photo: "hash",
        person_label_probability: 1,
      }))
    )
  );
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useFaceDataFetching", () => {
  it("does not request a page past the end of a person that shrank", async () => {
    // The user pushed most of this cluster back to "Unknown - Other", so the
    // refreshed list holds a single page. The grid still carries the page 2 it
    // worked out from the old count; asking for it returns 404 "Invalid page".
    seedPerson(30);

    await render([page(2)]);

    expect(stubs.fetchFaces).not.toHaveBeenCalled();
  });

  it("does not request faces for a person that is gone from the list", async () => {
    seedPerson(150);
    queryClient.setQueryData(INFERRED_KEY, []);

    await render([page(1)]);

    expect(stubs.fetchFaces).not.toHaveBeenCalled();
  });

  it("still requests the pages that are inside the person", async () => {
    seedPerson(150);

    await render([page(1), page(2)]);

    expect(stubs.fetchFaces).toHaveBeenCalledTimes(2);
    expect(firstCachedFace().isTemp).toBeUndefined();
  });

  it("reloads the pages on screen after a tagging mutation refreshed the list", async () => {
    seedPerson(150);
    const groups = [page(1)];
    await render(groups);
    expect(stubs.fetchFaces).toHaveBeenCalledTimes(1);

    // What a tagging mutation does: invalidate the face pages, then refetch the
    // incomplete list, which comes back as placeholders again.
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: faceKeys.personFaces() });
      seedPerson(150);
      isFetchingLists = true;
    });
    await render(groups);
    await act(async () => {
      isFetchingLists = false;
    });
    await render(groups);

    expect(stubs.fetchFaces).toHaveBeenCalledTimes(2);
    expect(firstCachedFace().isTemp).toBeUndefined();
  });

  it("orders the people by face count on a copy of the cached list (#764)", async () => {
    const cluster = (id: number, name: string, faceCount: number) => ({
      id,
      name,
      face_count: faceCount,
      kind: "CLUSTER",
      faces: placeholders(faceCount),
    });
    const cached = [cluster(1, "Unknown 001", 2), cluster(2, "Unknown 002", 9), cluster(3, "Unknown 003", 5)];
    queryClient.setQueryData<CompletePersonFaceList>(INFERRED_KEY, cached);

    await render([], "count");
    expect(lists?.inferred.map(person => person.id)).toEqual([2, 3, 1]);
    expect(queryClient.getQueryData<CompletePersonFaceList>(INFERRED_KEY)?.map(person => person.id)).toEqual([1, 2, 3]);

    await render([], "name");
    expect(lists?.inferred.map(person => person.id)).toEqual([1, 2, 3]);
  });
});
