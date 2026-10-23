import { ApiError, endpoints, userKeys, type PhotoOrder, type User } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { useAccessToken } from "../../auth/hooks";
import { useFetchUserSelfDetailsQuery } from "./useFetchUserSelfDetailsQuery";

/**
 * Which end of the date-grouped photo lists comes first (#2712): the signed-in user's
 * `photo_order`. Newest first for a visitor and from a server that does not send it.
 *
 * `ready` is false while the user is still loading: a list that fetched before would load (and
 * show) the other order for a moment.
 */
export function usePhotoOrder(): { order: PhotoOrder; ready: boolean } {
  const { data: auth, isPending: authPending } = useAccessToken();
  const userId = auth?.access?.user_id?.toString() ?? "";
  const { data: user, isPending: userPending } = useFetchUserSelfDetailsQuery(userId);
  return {
    order: user?.photo_order ?? "newest",
    ready: !authPending && (userId === "" || !userPending),
  };
}

/**
 * A query `select` that puts the date groups of the answer in the user's photo order with `reorder`
 * (a module-level function, so the select keeps its identity), and whether that order is known yet.
 */
export function usePhotoOrderSelect<T>(reorder: (data: T, order: PhotoOrder) => T) {
  const { order, ready } = usePhotoOrder();
  const select = useCallback((data: T) => reorder(data, order), [reorder, order]);
  return { select, ready };
}

type SetPhotoOrderRequest = { userId: number; order: PhotoOrder };

const withOrder = (userId: number, order: PhotoOrder) => (old: User | undefined) =>
  old?.id === userId ? { ...old, photo_order: order } : old;

/**
 * Saves the user's photo order, sending only that field. The cached user changes first, so every
 * list switches at once; a failed save puts the old order back and says so.
 */
export const useSetPhotoOrderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, order }: SetPhotoOrderRequest) =>
      endpoints.updateUserPartial(apiClient, userId, { photo_order: order }),
    onMutate: async ({ userId, order }: SetPhotoOrderRequest) => {
      await queryClient.cancelQueries({ queryKey: userKeys.selfDetails() });
      const previous = queryClient.getQueryData<User>(userKeys.selfDetail(userId))?.photo_order ?? "newest";
      queryClient.setQueriesData({ queryKey: userKeys.selfDetails() }, withOrder(userId, order));
      return { previous };
    },
    onError: (error, { userId }, context) => {
      if (context) {
        queryClient.setQueriesData({ queryKey: userKeys.selfDetails() }, withOrder(userId, context.previous));
      }
      notification.saveFailed(error instanceof ApiError ? error.serverMessage : null);
    },
  });
};
