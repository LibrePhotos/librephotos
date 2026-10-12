import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useFetchSocialGraphQuery = () =>
  useQuery({
    queryKey: statsKeys.socialGraph(),
    queryFn: () => endpoints.fetchSocialGraph(apiClient),
  });

export type { SocialGraph as PersonDataPointList } from "@librephotos/api-client";
