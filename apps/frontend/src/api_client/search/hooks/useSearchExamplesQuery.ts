import { endpoints, searchKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useSearchExamplesQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: searchKeys.examples(),
    queryFn: () => endpoints.fetchSearchExamples(apiClient),
    enabled: !skip,
  });
