import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { RenameTagParams } from "../types";
import { TagAlbumQueryKeys } from "./useFetchTagAlbumQuery";
import { TagsQueryKeys } from "./useFetchTagsQuery";

export const useRenameTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, newName }: RenameTagParams) => {
      await fetchClient.patch(`/tags/${id}/`, { name: newName });
      notification.renameTag(name, newName);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...TagAlbumQueryKeys, `${id}`] });
    },
  });
