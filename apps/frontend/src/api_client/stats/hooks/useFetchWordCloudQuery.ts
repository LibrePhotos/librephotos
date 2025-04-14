import { useQuery } from "@tanstack/react-query";
import { fetchClient, QueryKeys } from "../../api";
import { WordCloudResponse } from "../types";


export const useFetchWordCloudQuery = () => useQuery({
    queryKey: [QueryKeys.wordCloud],
    queryFn: async () => {
      const response = await fetchClient.get('/wordcloud/');
      return WordCloudResponse.parse(response);
    },
  });           