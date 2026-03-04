import { z } from 'zod'

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

export enum SyncStatus {
  SYNCED = 'synced',
  LOCAL = 'local',
  SYNCING = 'syncing',
}

export const LocalImage = z.object({
  id: z.string(),
  dominantColor: z.string().optional(),
  url: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional().nullable(),
  birthTime: z.string().optional().nullable(),
  aspectRatio: z.number(),
  type: z.nativeEnum(MediaType).default(MediaType.IMAGE),
  syncStatus: z.nativeEnum(SyncStatus).default(SyncStatus.LOCAL),
  video_length: z.string().optional(),
  rating: z.number().default(0),
  isTemp: z.boolean().default(false),
})

export const LocalImages = LocalImage.array()

export const LocalImagesStateSchema = z.object({
  images: LocalImages,
  lastFetch: z.number().optional(),
  isLoading: z.boolean().default(false),
})

export type LocalImagesState = z.infer<typeof LocalImagesStateSchema>
export type LocalImage = z.infer<typeof LocalImage>
export type LocalImages = z.infer<typeof LocalImages>
