import { useMutation } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, queryClient } from "../../api";
import { notification } from "../../../service/notifications";
import { User } from "../types";
import { UserSelfDetailsQueryKeys } from './useFetchUserSelfDetailsQuery';
import { UserListQueryKeys } from './useFetchUserListQuery';

export const useUpdateAvatarMutation = () => useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await fetchClient.patch(`/user/${id}/`, data);
      return User.parse(response);
    },
    onSuccess: (data) => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] });
    },
  });