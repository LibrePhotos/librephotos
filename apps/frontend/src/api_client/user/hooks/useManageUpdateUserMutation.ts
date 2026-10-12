import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { userKeys } from "../keys";
import type { ManageUserPatch } from "../types";

// Manage Update User Mutation
export const useManageUpdateUserMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ManageUserPatch) => endpoints.manageUpdateUser(apiClient, data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};
