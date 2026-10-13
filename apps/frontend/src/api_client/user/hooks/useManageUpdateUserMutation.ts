import { endpoints, userKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";
import type { ManageUserPatch } from "../types";

// Manage Update User Mutation
export const useManageUpdateUserMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();

  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (data: ManageUserPatch) => endpoints.manageUpdateUser(apiClient, data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};
