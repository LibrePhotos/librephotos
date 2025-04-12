import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { z } from 'zod';

export const UploadExistResponse = z.object({
  exists: z.boolean(),
});

// Upload
const uploadExists =  (hash: string) =>     
    fetchClient.get<string>(`/exists/${hash}`)
      .then(response => UploadExistResponse.parse(response).exists),

export const useUploadExists = (hash: string) => {
  return useQuery({
    queryKey: ['uploadExists', hash],
    queryFn: () => uploadExists(hash),
  });
}; 