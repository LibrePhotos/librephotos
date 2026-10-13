import { endpoints, photoGridKeys, photoKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

export const useSavePhotoCaptionMutation = () =>
  useMutation({
    mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
      await endpoints.savePhotoCaption(apiClient, id, caption);
      notification.savePhotoCaptions();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: photoKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("search") });
    },
  });
