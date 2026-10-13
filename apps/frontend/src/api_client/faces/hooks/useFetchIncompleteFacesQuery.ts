import { endpoints, faceKeys } from "@librephotos/api-client";
import type { IncompletePersonFaceListRequest } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import type { CompletePersonFace, CompletePersonFaceList } from "../types";

/** Every person with a placeholder per face; the grid swaps them for real faces page by page. */
const fetchIncompleteFaces = async (params: IncompletePersonFaceListRequest): Promise<CompletePersonFaceList> => {
  const people = await endpoints.fetchIncompleteFaces(apiClient, {
    inferred: params.inferred,
    orderBy: params.orderBy,
    analysisMethod: params.method,
    // 0 is the server's default: left out, as it always was.
    minConfidence: params.minConfidence || undefined,
  });
  return people.map(person => {
    const completePersonFace: CompletePersonFace = { ...person, faces: [] };
    for (let i = 0; i < person.face_count; i += 1) {
      completePersonFace.faces.push({
        id: i,
        image: null,
        face_url: null,
        photo: "",
        person_label_probability: 1,
        person: person.id,
        isTemp: true,
      });
    }
    return completePersonFace;
  });
};

export const useFetchIncompleteFacesQuery = (request: IncompletePersonFaceListRequest) =>
  useQuery({
    queryKey: faceKeys.incompleteList(request),
    queryFn: () => fetchIncompleteFaces(request),
  });
