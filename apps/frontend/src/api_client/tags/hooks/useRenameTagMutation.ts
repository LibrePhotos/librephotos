import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { tagKeys } from "../keys";
import type { RenameTagParams } from "../types";

export const useRenameTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name, newName }: RenameTagParams) => {
      await endpoints.renameTag(apiClient, id, newName);
      notification.renameTag(name, newName);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.tagAlbum(String(id)) });
    },
  });
