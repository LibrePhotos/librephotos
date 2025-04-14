import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { z } from 'zod';


export type GenerateEventAlbumsTitlesResponse = z.infer<typeof GenerateEventAlbumsTitlesResponse>;
export const GenerateEventAlbumsTitlesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const useGenerateAutoAlbumTitleQuery = () => useQuery({
  queryKey: [QueryKeys.generateAutoAlbumTitle],
  queryFn: async () => {
    const response = await fetchClient.get<string>('/autoalbumtitlegen/');
    return JSON.parse(response) as GenerateEventAlbumsTitlesResponse;
  },
}); 