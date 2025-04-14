import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { z } from 'zod';

export const ImageTagResponse = z.object({
    image_tag: z.string(),
    git_hash: z.string(),
  });
  
  export type ImageTagResponse = z.infer<typeof ImageTagResponse>; 

export const useFetchImageTagQuery = () => useQuery({
  queryKey: [QueryKeys.imageTag],
  queryFn: async () => {
    const response = await fetchClient.get('/imagetag/');
    return ImageTagResponse.parse(response);
  },
}); 