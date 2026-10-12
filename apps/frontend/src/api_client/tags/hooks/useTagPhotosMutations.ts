import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { tagKeys } from "../keys";
import type { TagPhotosParams } from "../types";

export const useAddPhotosToTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, photos }: TagPhotosParams) => {
      await fetchClient.post(`/tags/${id}/add/`, { photos });
      notification.addPhotosToTag(name, photos.length);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.tagAlbum(String(id)) });
    },
  });

export const useRemovePhotosFromTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, photos }: TagPhotosParams) => {
      await fetchClient.post(`/tags/${id}/remove/`, { photos });
      notification.removePhotosFromTag(name, photos.length);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.tagAlbum(String(id)) });
    },
  });
