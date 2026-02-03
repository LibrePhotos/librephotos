import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { SearchExamplesResponse } from "../types";

export const SearchExamplesQueryKeys = ["searchExamples"] as const;

export const useSearchExamplesQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: [...SearchExamplesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get<{ results: string[] }>("/searchtermexamples/");
      return parseWithNotification(SearchExamplesResponse, response, "Failed to parse search examples").results;
    },
    enabled: !skip,
  });
