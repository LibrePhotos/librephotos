import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { userKeys } from "../keys";
import { ManageUser } from "../types";

export type UpdateScanDirectoryRequest = {
  id: number;
  scan_directory: string | null;
};

export const useUpdateUserScanDirectoryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, scan_directory }: UpdateScanDirectoryRequest) => {
      const response = await fetchClient.patch(`/manage/user/${id}/`, {
        scan_directory,
      });
      return parseWithNotification(ManageUser, response, "Failed to parse update user scan directory response");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    },
  });
};
