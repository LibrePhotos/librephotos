import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { tagKeys } from "../keys";
import type { CreateTagParams } from "../types";
import { Tag } from "../types";

export const useCreateTagMutation = () =>
  useMutation({
    mutationFn: async ({ name }: CreateTagParams) => {
      const response = await fetchClient.post(`/tags/`, { name });
      const tag = parseWithNotification(Tag, response, "Failed to parse tag");
      notification.createTag(name);
      return tag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
