import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { searchKeys } from "../keys";
import { SearchExamplesResponse } from "../types";

export const useSearchExamplesQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: searchKeys.examples(),
    queryFn: async () => {
      const response = await fetchClient.get("/searchtermexamples/");
      return parseWithNotification(SearchExamplesResponse, response, "Failed to parse search examples").results;
    },
    enabled: !skip,
  });
