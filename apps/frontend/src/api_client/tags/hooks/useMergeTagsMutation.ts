import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { MergeTagsParams } from "../types";
import { TagAlbumQueryKeys } from "./useFetchTagAlbumQuery";
import { TagsQueryKeys } from "./useFetchTagsQuery";

export const useMergeTagsMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, sourceId, sourceName }: MergeTagsParams) => {
      await fetchClient.post(`/tags/${id}/merge/`, { tag: sourceId });
      notification.mergeTags(sourceName, name);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...TagAlbumQueryKeys, `${id}`] });
    },
  });
