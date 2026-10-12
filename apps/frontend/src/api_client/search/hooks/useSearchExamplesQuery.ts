import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { searchKeys } from "../keys";

export const useSearchExamplesQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: searchKeys.examples(),
    queryFn: () => endpoints.fetchSearchExamples(apiClient),
    enabled: !skip,
  });
