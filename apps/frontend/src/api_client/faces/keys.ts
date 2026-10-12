import type { PersonFaceListRequest } from "./hooks/useFetchFacesQuery";
import type { IncompletePersonFaceListRequest } from "./hooks/useFetchIncompleteFacesQuery";

const root = ["faces"] as const;

export const faceKeys = {
  all: root,
  /** Every person's page of faces. */
  personFaces: () => [...root, "person"] as const,
  personFacePage: (request: PersonFaceListRequest) => [...faceKeys.personFaces(), request] as const,
  /** Every people list (people with face counts, faces not loaded yet). */
  incomplete: () => [...root, "incomplete"] as const,
  incompleteList: (request: IncompletePersonFaceListRequest) => [...faceKeys.incomplete(), request] as const,
  clusters: () => [...root, "clusters"] as const,
};
