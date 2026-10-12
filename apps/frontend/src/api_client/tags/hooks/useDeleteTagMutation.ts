import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { tagKeys } from "../keys";
import type { DeleteTagParams } from "../types";

export const useDeleteTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name }: DeleteTagParams) => {
      await endpoints.deleteTag(apiClient, id);
      notification.deleteTag(name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
