import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchClient } from '../../api';

export const UploadExistResponse = z.object({
  exists: z.boolean(),
});

// Upload
const uploadExists =  (hash: string) =>     
    fetchClient.get<string>(`/exists/${hash}`)
      .then(response => UploadExistResponse.parse(response).exists)

export const useUploadExists = (hash: string) => useQuery({
    queryKey: ['uploadExists', hash],
    queryFn: () => uploadExists(hash),
  }); 