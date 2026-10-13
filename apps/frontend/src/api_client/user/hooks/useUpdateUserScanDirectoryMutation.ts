import { endpoints, userKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

export type UpdateScanDirectoryRequest = {
  id: number;
  scan_directory: string | null;
};

export const useUpdateUserScanDirectoryMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();

  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id, scan_directory }: UpdateScanDirectoryRequest) =>
      endpoints.manageUpdateUser(apiClient, id, { scan_directory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    },
  });
};
