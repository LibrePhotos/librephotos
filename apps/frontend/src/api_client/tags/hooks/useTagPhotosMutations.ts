import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { TagPhotosParams } from "../types";
import { TagAlbumQueryKeys } from "./useFetchTagAlbumQuery";
import { TagsQueryKeys } from "./useFetchTagsQuery";

export const useAddPhotosToTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, photos }: TagPhotosParams) => {
      await fetchClient.post(`/tags/${id}/add/`, { photos });
      notification.addPhotosToTag(name, photos.length);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...TagAlbumQueryKeys, `${id}`] });
    },
  });

export const useRemovePhotosFromTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, photos }: TagPhotosParams) => {
      await fetchClient.post(`/tags/${id}/remove/`, { photos });
      notification.removePhotosFromTag(name, photos.length);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...TagAlbumQueryKeys, `${id}`] });
    },
  });
