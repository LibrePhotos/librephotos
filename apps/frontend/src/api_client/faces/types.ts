import type { PersonFace as ApiPersonFace, IncompletePersonFace } from "@librephotos/api-client";

export {
  FaceAnalysisMethod,
  FaceOrderBy as FacesOrderOption,
  type ClusterFacesResponse,
  type NormalizedFaceBox,
} from "@librephotos/api-client";

/** A face on the dashboard: a face row, or a placeholder (`isTemp`) for one whose page is not loaded yet. */
export type PersonFace = ApiPersonFace & { isTemp?: boolean };
export type PersonFaceList = PersonFace[];

/** A person (or "Unknown - Other") with their faces, placeholders until the grid loads the page. */
export type CompletePersonFace = IncompletePersonFace & { faces: PersonFaceList };
export type CompletePersonFaceList = CompletePersonFace[];
