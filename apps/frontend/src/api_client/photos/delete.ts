import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { PhotoSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../api";

const DeletePhotosRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  deleted: z.boolean(),
});
type DeletePhotosRequest = z.infer<typeof DeletePhotosRequestSchema>;

const DeleteDuplicatePhotoRequestSchema = z.object({
  image_hash: z.string(),
  path: z.string(),
});
type DeleteDuplicatePhotoRequest = z.infer<typeof DeleteDuplicatePhotoRequestSchema>;

const DeletePhotosResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
type DeletePhotosResponse = z.infer<typeof DeletePhotosResponseSchema>;

const DeleteMissingPhotosResponseSchema = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});
type DeleteMissingPhotosResponse = z.infer<typeof DeleteMissingPhotosResponseSchema>;

const PurgePhotosRequestSchema = z.object({
  image_hashes: z.array(z.string()),
});
type PurgePhotosRequest = z.infer<typeof PurgePhotosRequestSchema>;

const PurgePhotosResponseSchema = z.object({
  status: z.boolean(),
  results: z.string().array(),
  deleted: z.string().array(),
  not_deleted: z.string().array(),
});
type PurgePhotosResponse = z.infer<typeof PurgePhotosResponseSchema>;

// Mark photos as deleted
export const useMarkPhotosDeletedMutation = () => useMutation({
  mutationFn: async ({ image_hashes, deleted }: DeletePhotosRequest) => {
    const response = await fetchClient.post('photosedit/setdeleted/', { image_hashes, deleted });
    const data = DeletePhotosResponseSchema.parse(response);
    notification.togglePhotoDelete(deleted, data.updated.length);
    return data;
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
});

// Purge deleted photos
export const usePurgeDeletedPhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes }: PurgePhotosRequest) => {
    const response = await fetchClient.delete('photosedit/delete/', { image_hashes });
    const data = PurgePhotosResponseSchema.parse(response);
    notification.removePhotos(data.deleted.length);
    return data;
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
});

// Delete duplicate photo
export const useDeleteDuplicatePhotoMutation = () => useMutation({
  mutationFn: async ({ image_hash, path }: DeleteDuplicatePhotoRequest) => {
    await fetchClient.delete('photosedit/duplicate/delete/', { image_hash, path });
    notification.removePhotos(1);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
});

// Delete missing photos
export const useDeleteMissingPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('deletemissingphotos', {});
    return DeleteMissingPhotosResponseSchema.parse(response);
  },
  onSuccess: (data) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
}); 