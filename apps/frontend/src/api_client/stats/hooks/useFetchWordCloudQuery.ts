import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";
import { WordCloudResponse } from "../types";

export const WordCloudQueryKeys = ['wordCloud'] as const;

export const useFetchWordCloudQuery = () => useQuery({
    queryKey: [...WordCloudQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/wordcloud/');
      return WordCloudResponse.parse(response);
    },
  });           