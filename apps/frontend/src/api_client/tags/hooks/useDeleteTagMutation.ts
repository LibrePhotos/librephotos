import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { DeleteTagParams } from "../types";
import { TagsQueryKeys } from "./useFetchTagsQuery";

export const useDeleteTagMutation = () =>
  useMutation({
    mutationFn: async ({ id, name }: DeleteTagParams) => {
      await fetchClient.delete(`/tags/${id}/`);
      notification.deleteTag(name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
    },
  });
