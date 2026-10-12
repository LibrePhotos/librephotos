import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { tagKeys } from "../keys";
import type { CreateTagParams } from "../types";

export const useCreateTagMutation = () =>
  useMutation({
    mutationFn: async ({ name }: CreateTagParams) => {
      const tag = await endpoints.createTag(apiClient, name);
      notification.createTag(name);
      return tag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
