import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { ManageUser } from "../types";
import { UserListQueryKeys } from "./useFetchUserListQuery";
import { UserSelfDetailsQueryKeys } from "./useFetchUserSelfDetailsQuery";

export type UpdateScanDirectoryRequest = {
  id: number;
  scan_directory: string | null;
  skip_raw_files?: boolean;
};

export const useUpdateUserScanDirectoryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, scan_directory, skip_raw_files }: UpdateScanDirectoryRequest) => {
      const response = await fetchClient.patch<ManageUser>(`/manage/user/${id}/`, {
        scan_directory,
        skip_raw_files,
      });
      return parseWithNotification(ManageUser, response, "Failed to parse update user scan directory response");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
    },
  });
};
