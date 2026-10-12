import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { userKeys } from "../keys";

export type UpdateScanDirectoryRequest = {
  id: number;
  scan_directory: string | null;
};

export const useUpdateUserScanDirectoryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, scan_directory }: UpdateScanDirectoryRequest) =>
      endpoints.manageUpdateUser(apiClient, id, { scan_directory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    },
  });
};
