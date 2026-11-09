import type { FaceAnalysisMethod } from "@librephotos/api-client";
import { endpoints, faceKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type Params = Readonly<{
  /** The face dashboard's Suggested tab filters, so a link showing the number lands on it. */
  method: FaceAnalysisMethod;
  minConfidence: number;
  /** One group of people, as the dashboard's group filter narrows it (#1126). */
  group?: number;
  enabled?: boolean;
}>;

/** How many faces wait for review: what the face dashboard's Suggested tab lists. */
export const useFacesReviewCountQuery = ({ method, minConfidence, group, enabled = true }: Params) =>
  useQuery({
    queryKey: faceKeys.reviewCount({ method, minConfidence, group }),
    queryFn: () => endpoints.fetchFacesReviewCount(apiClient, { analysisMethod: method, minConfidence, group }),
    select: data => data.suggested,
    // A backlog, not live news: once in a while is enough, and labelling refreshes it at once.
    staleTime: 5 * 60 * 1000,
    enabled,
  });
