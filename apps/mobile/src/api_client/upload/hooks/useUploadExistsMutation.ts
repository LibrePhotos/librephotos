import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'

export const UploadExistResponse = z.object({
  exists: z.boolean(),
})

// Upload
const uploadExists = (hash: string) =>
  fetchClient
    .get<string>(`/exists/${hash}`)
    .then(
      response =>
        parseWithNotification(
          UploadExistResponse,
          response,
          'Failed to parse upload exists response',
        ).exists,
    )

export const useUploadExists = (hash: string) =>
  useQuery({
    queryKey: ['uploadExists', hash],
    queryFn: () => uploadExists(hash),
  })
