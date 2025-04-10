import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from "zod";

import type { Photo } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";

const PhotoUpdateResponseSchema = z.object({
  image_hash: z.string(),
  hidden: z.boolean(),
  rating: z.number(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  video: z.boolean(),
  exif_timestamp: z.string(),
  timestamp: z.string(),
});
type PhotoUpdateResponse = z.infer<typeof PhotoUpdateResponseSchema>;

const StatusResponseSchema = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponseSchema>;

// Fetch photo details
export const useFetchPhotoDetailsQuery = (hash: string) => useQuery({
  queryKey: [QueryKeys.autoAlbum, hash],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/${hash}/`);
    return response as Photo;
  },
});

// Update photo
export const useUpdatePhotoMutation = () => useMutation({
  mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
    const response = await fetchClient.patch(`/photos/edit/${id}/`, data);
    const result = PhotoUpdateResponseSchema.parse(response);
    notification.updatePhoto();
    return result;
  },
  onSuccess: (data) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, data.image_hash] });
  },
});

// Save photo caption
export const useSavePhotoCaptionMutation = () => useMutation({
  mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
    const response = await fetchClient.post(`/photosedit/savecaption/`, { image_hash: id, caption });
    StatusResponseSchema.parse(response);
    notification.savePhotoCaptions();
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, id] });
  },
});

// Generate image to text caption
export const useGenerateImageToTextCaptionMutation = () => useMutation({
  mutationFn: async ({ id }: { id: string }) => {
    const response = await fetchClient.post(`/photosedit/generateim2txt/`, { image_hash: id });
    StatusResponseSchema.parse(response);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, id] });
  },
}); 