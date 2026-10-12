import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { userKeys } from "../keys";

// Delete User Mutation
export const useDeleteUserMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: number) => {
      await apiClient.delete(`/delete/user/${userId}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};
