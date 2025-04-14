import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { z } from 'zod';

export const ImageTagResponse = z.object({
    image_tag: z.string(),
    git_hash: z.string(),
  });
  
  export type ImageTagResponse = z.infer<typeof ImageTagResponse>; 

export const ImageTagQueryKeys = ['imageTag'] as const;

export const useFetchImageTagQuery = () => useQuery({
  queryKey: [...ImageTagQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/imagetag/');
    return ImageTagResponse.parse(response);
  },
}); 