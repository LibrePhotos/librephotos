import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { z } from 'zod';

export const GenerateAutoAlbumTitleQueryKeys = ['generateAutoAlbumTitle'] as const;

export type GenerateEventAlbumsTitlesResponse = z.infer<typeof GenerateEventAlbumsTitlesResponse>;
export const GenerateEventAlbumsTitlesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const useGenerateAutoAlbumTitleQuery = (title: string) => useQuery({
  queryKey: [...GenerateAutoAlbumTitleQueryKeys, title],
  queryFn: async () => {
    const response = await fetchClient.get(`/generateeventalbums/titles/?title=${title}`);
    return GenerateEventAlbumsTitlesResponse.parse(response);
  },
  enabled: !!title,
}); 