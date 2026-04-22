import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'

export const ImageTagResponse = z.object({
  image_tag: z.string(),
  git_hash: z.string(),
})

export type ImageTagResponse = z.infer<typeof ImageTagResponse>

export const ImageTagQueryKeys = ['imageTag'] as const

export const useFetchImageTagQuery = () =>
  useQuery({
    queryKey: [...ImageTagQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/imagetag/')
      return parseWithNotification(
        ImageTagResponse,
        response,
        'Failed to parse image tag',
      )
    },
  })
