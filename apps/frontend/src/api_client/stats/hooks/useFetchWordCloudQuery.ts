import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { statsKeys } from "../keys";
import { WordCloudResponse } from "../types";

export const useFetchWordCloudQuery = () =>
  useQuery({
    queryKey: statsKeys.wordCloud(),
    queryFn: async () => {
      const response = await fetchClient.get("/wordcloud/");
      return parseWithNotification(WordCloudResponse, response, "Failed to parse word cloud");
    },
  });
