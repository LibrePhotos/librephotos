import { endpoints } from "@librephotos/api-client";
import type { PersonFaceListRequest } from "@librephotos/api-client";
import { apiClient } from "../../api";
import type { PersonFaceList } from "../types";

/** One page of a person's faces (person 0: the faces of no one). */
export const fetchFaces = async (params: PersonFaceListRequest): Promise<PersonFaceList> => {
  const page = await endpoints.fetchFaces(apiClient, {
    person: params.person,
    page: params.page,
    inferred: params.inferred,
    orderBy: params.orderBy,
    analysisMethod: params.method,
    // 0 is the server's default: left out, as it always was.
    minConfidence: params.minConfidence || undefined,
    deleted: params.deleted,
  });
  return page.results;
};
