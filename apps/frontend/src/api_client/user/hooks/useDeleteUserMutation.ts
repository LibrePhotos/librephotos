import { endpoints, userKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

// Delete User Mutation
export const useDeleteUserMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();

  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (userId: number) => endpoints.deleteUser(apiClient, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};
