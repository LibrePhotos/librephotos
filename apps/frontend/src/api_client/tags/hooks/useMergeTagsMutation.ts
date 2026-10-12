import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { tagKeys } from "../keys";
import type { MergeTagsParams } from "../types";

export const useMergeTagsMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, sourceId, sourceName }: MergeTagsParams) => {
      await endpoints.mergeTags(apiClient, id, sourceId);
      notification.mergeTags(sourceName, name);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.tagAlbum(String(id)) });
    },
  });
