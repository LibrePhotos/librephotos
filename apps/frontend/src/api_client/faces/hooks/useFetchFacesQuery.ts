import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { CompletePersonFace, FaceAnalysisMethod, FacesOrderOption, PersonFace } from "../types";

export const PersonFaceListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(PersonFace),
});
export type PersonFaceListResponse = z.infer<typeof CompletePersonFace>;
export const PersonFaceListRequest = z.object({
  person: z.number().optional(),
  page: z.number(),
  inferred: z.boolean(),
  orderBy: FacesOrderOption,
  method: FaceAnalysisMethod.optional(),
  minConfidence: z.number().optional(),
});

export type PersonFaceListRequest = z.infer<typeof PersonFaceListRequest>;

export const fetchFaces = (params: PersonFaceListRequest) => {
  const { person, page = 0, inferred = false, orderBy = "confidence", method, minConfidence } = params;
  const url = `/faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}${
    method ? `&analysis_method=${method}` : ""
  }${minConfidence ? `&min_confidence=${minConfidence}` : ""}`;

  return fetchClient.get(url).then(response => {
    const parsedResponse = parseWithNotification(PersonFaceListResponse, response, "Failed to parse faces response");
    return parsedResponse.results;
  });
};

export const FacesQueryKeys = ["faces"] as const;

export const useFetchFacesQuery = (params: PersonFaceListRequest) =>
  useQuery({
    queryKey: [FacesQueryKeys, params],
    queryFn: () => fetchFaces(params),
    enabled: !!params,
  });
