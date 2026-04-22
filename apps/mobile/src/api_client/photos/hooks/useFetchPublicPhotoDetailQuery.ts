import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchClient } from '../../api'

// Response schema for public photo detail
export const PublicPhotoDetail = z.object({
  image_hash: z.string(),
  video: z.boolean(),
  square_thumbnail_url: z.string(),
  big_thumbnail_url: z.string(),
  small_square_thumbnail_url: z.string(),
  // Conditional fields based on sharing settings
  exif_timestamp: z.string().nullable().optional(),
  exif_gps_lat: z.number().nullable().optional(),
  exif_gps_lon: z.number().nullable().optional(),
  geolocation_json: z.record(z.unknown()).nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  focal_length: z.number().nullable().optional(),
  fstop: z.number().nullable().optional(),
  iso: z.number().nullable().optional(),
  shutter_speed: z.string().nullable().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.unknown()).optional(),
  people: z
    .array(
      z.object({
        name: z.string(),
        face_url: z.string().nullable(),
        face_id: z.number(),
      }),
    )
    .optional(),
})
export type PublicPhotoDetail = z.infer<typeof PublicPhotoDetail>

export const PublicPhotoDetailResponse = z.object({
  results: PublicPhotoDetail,
  sharing_settings: z.object({
    share_location: z.boolean(),
    share_camera_info: z.boolean(),
    share_timestamps: z.boolean(),
    share_captions: z.boolean(),
    share_faces: z.boolean(),
  }),
})
export type PublicPhotoDetailResponse = z.infer<
  typeof PublicPhotoDetailResponse
>

export const PublicPhotoDetailQueryKeys = ['publicPhotoDetail'] as const

async function fetchPublicPhotoDetail(
  slug: string,
  photoId: string,
): Promise<PublicPhotoDetailResponse> {
  const response = await fetchClient.get<PublicPhotoDetailResponse>(
    `/public/albums/s/${slug}/photos/${photoId}/`,
  )

  const parsed = PublicPhotoDetailResponse.safeParse(response)
  if (!parsed.success) {
    console.error('Failed to parse public photo detail:', parsed.error.errors)
    console.error('Response was:', response)
    throw new Error('Failed to parse public photo detail response')
  }
  return parsed.data
}

type UseFetchPublicPhotoDetailQueryParams = {
  slug: string
  photoId: string
  enabled?: boolean
}

export const useFetchPublicPhotoDetailQuery = ({
  slug,
  photoId,
  enabled = true,
}: UseFetchPublicPhotoDetailQueryParams) =>
  useQuery({
    queryKey: [...PublicPhotoDetailQueryKeys, slug, photoId],
    queryFn: () => fetchPublicPhotoDetail(slug, photoId),
    enabled: enabled && !!slug && !!photoId,
  })
