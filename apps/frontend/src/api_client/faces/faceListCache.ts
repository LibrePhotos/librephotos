import { albumKeys, coalesce, endpoints, faceKeys, photoKeys, statsKeys } from "@librephotos/api-client";
import type { IncompletePersonFace, IncompletePersonFaceListRequest } from "@librephotos/api-client";
import { hashKey, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "../api";
import type { CompletePersonFace, CompletePersonFaceList, PersonFace } from "./types";

/*
 * The face dashboard's people lists (faceKeys.incompleteList): every person with a slot per face,
 * placeholders until the grid pages the faces in. With tens of thousands of faces, refetching
 * those lists after each edit threw every loaded face away, built the placeholders again, and
 * reloaded the pages on screen one by one; tagging face after face did all of that once per click.
 * An edit now takes its faces out of the lists in place, and one refresh after a burst of edits
 * asks the server for the new counts while keeping the faces that are already loaded.
 */

/** How long a refresh waits for the next edit, and how long a stream of edits can put it off. */
const REFRESH_WAIT_MS = 1000;
const REFRESH_MAX_WAIT_MS = 4000;

/** The face of a slot whose page is not loaded yet: its index as its id. */
const placeholder = (person: number, index: number): PersonFace => ({
  id: index,
  image: null,
  face_url: null,
  photo: "",
  person_label_probability: 1,
  person,
  isTemp: true,
});

const withPlaceholdersFor = (person: IncompletePersonFace): CompletePersonFace => ({
  ...person,
  faces: Array.from({ length: person.face_count }, (_, index) => placeholder(person.id, index)),
});

/** Every person with a placeholder per face; the grid swaps them for real faces page by page. */
export function withPlaceholders(people: readonly IncompletePersonFace[]): CompletePersonFaceList {
  return people.map(withPlaceholdersFor);
}

/** The requests behind the people lists in the cache, by query hash: a refresh asks for them again. */
const listRequests = new Map<string, IncompletePersonFaceListRequest>();

/** The people of one list, as the server counts them now. */
export async function fetchIncompletePeople(request: IncompletePersonFaceListRequest): Promise<IncompletePersonFace[]> {
  listRequests.set(hashKey(faceKeys.incompleteList(request)), request);
  return endpoints.fetchIncompleteFaces(apiClient, {
    inferred: request.inferred,
    orderBy: request.orderBy,
    analysisMethod: request.method,
    // 0 is the server's default: left out, as it always was.
    minConfidence: request.minConfidence || undefined,
    deleted: request.deleted,
    group: request.group,
  });
}

/**
 * The people without the given faces. Loaded faces are matched by id (placeholders have none yet);
 * the placeholders after them take their new index, so the pages the grid asks for line up with
 * the server's pages again. A person left without faces is dropped, as the server drops them.
 * Answers the same list when none of its faces was edited.
 */
export function withoutFaces(people: CompletePersonFaceList, faceIds: ReadonlySet<number>): CompletePersonFaceList {
  const isEdited = (face: PersonFace) => !face.isTemp && faceIds.has(face.id);
  let changed = false;
  const next: CompletePersonFaceList = [];
  for (const person of people) {
    if (!person.faces.some(isEdited)) {
      next.push(person);
      continue;
    }
    changed = true;
    const faces = person.faces
      .filter(face => !isEdited(face))
      .map((face, index) => (face.isTemp && face.id !== index ? { ...face, id: index } : face));
    if (faces.length > 0) {
      next.push({ ...person, face_count: faces.length, faces });
    }
  }
  return changed ? next : people;
}

const samePerson = (fresh: IncompletePersonFace | undefined, cached: CompletePersonFace) =>
  fresh !== undefined &&
  fresh.id === cached.id &&
  fresh.name === cached.name &&
  fresh.kind === cached.kind &&
  fresh.face_count === cached.faces.length &&
  (fresh.similarity_rank ?? null) === (cached.similarity_rank ?? null);

/**
 * The refreshed people with the faces the cache already loaded: a person whose count is the one the
 * cache holds keeps their faces, the others (faces moved to them, or a change the edits did not
 * account for) start over with placeholders. Answers the cached list itself when nothing changed,
 * so the grid is not laid out again.
 */
export function mergeLoadedFaces(
  fresh: readonly IncompletePersonFace[],
  cached: CompletePersonFaceList | undefined
): CompletePersonFaceList {
  if (!cached) return withPlaceholders(fresh);
  if (fresh.length === cached.length && cached.every((person, index) => samePerson(fresh[index], person))) {
    return cached;
  }
  const cachedById = new Map(cached.map(person => [person.id, person]));
  return fresh.map(person => {
    const kept = cachedById.get(person.id);
    return kept && kept.faces.length === person.face_count
      ? { ...person, faces: kept.faces }
      : withPlaceholdersFor(person);
  });
}

type EditState = {
  /** Counts the edits: a refresh that an edit overtook drops its answer, the next one follows. */
  generation: number;
  scheduleRefresh: () => void;
};

const editStates = new WeakMap<QueryClient, EditState>();

function editStateOf(queryClient: QueryClient): EditState {
  let state = editStates.get(queryClient);
  if (!state) {
    const created: EditState = {
      generation: 0,
      scheduleRefresh: coalesce(() => void refreshAfterEdits(queryClient, created), {
        waitMs: REFRESH_WAIT_MS,
        maxWaitMs: REFRESH_MAX_WAIT_MS,
      }),
    };
    editStates.set(queryClient, created);
    state = created;
  }
  return state;
}

/** The face dashboard's people lists in the cache (not the raw lists the mobile hooks keep). */
function cachedFaceLists(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: faceKeys.incomplete() })
    .flatMap(query => {
      const request = listRequests.get(query.queryHash);
      return request ? [{ query, request }] : [];
    });
}

async function refreshAfterEdits(queryClient: QueryClient, state: EditState): Promise<void> {
  const { generation } = state;
  // The people albums (face counts, covers), the statistics and the photos' people
  for (const queryKey of [albumKeys.peopleAlbums(), statsKeys.counts(), photoKeys.details(), faceKeys.personFaces()]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  await Promise.all(
    cachedFaceLists(queryClient).map(async ({ query, request }) => {
      const queryKey = faceKeys.incompleteList(request);
      if (!query.isActive()) {
        // Nobody shows it: refetched in full when a dashboard asks for it again
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
        return;
      }
      try {
        const fresh = await fetchIncompletePeople(request);
        if (state.generation !== generation) return;
        queryClient.setQueryData<CompletePersonFaceList>(queryKey, cached => mergeLoadedFaces(fresh, cached));
      } catch {
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
    })
  );
}

/**
 * After faces were labelled, deleted or restored: they leave the people lists at once, the face
 * pages are refetched when the grid next asks for them, and the lists, people albums, statistics
 * and photo details are refreshed once the edits pause.
 */
export function applyFaceEdits(queryClient: QueryClient, faceIds: readonly number[]): void {
  const state = editStateOf(queryClient);
  state.generation += 1;
  const edited = new Set(faceIds);
  if (edited.size > 0) {
    for (const { request } of cachedFaceLists(queryClient)) {
      const queryKey = faceKeys.incompleteList(request);
      const people = queryClient.getQueryData<CompletePersonFaceList>(queryKey);
      const next = people && withoutFaces(people, edited);
      if (next && next !== people) {
        queryClient.setQueryData<CompletePersonFaceList>(queryKey, next);
      }
    }
    // The pages cached for those people start at other faces now
    void queryClient.invalidateQueries({ queryKey: faceKeys.personFaces(), refetchType: "none" });
  }
  state.scheduleRefresh();
}
