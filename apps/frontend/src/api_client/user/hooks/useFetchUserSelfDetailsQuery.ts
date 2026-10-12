import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { userKeys } from "../keys";
import { User } from "../types";

// User Self Details Query
export const useFetchUserSelfDetailsQuery = (userId: string) =>
  useQuery<User>({
    queryKey: userKeys.selfDetail(userId),
    queryFn: async () => {
      const response = await apiClient.get(`/user/${userId}/`);
      return parseWithNotification(User, response, "Failed to parse user self details");
    },
    enabled: !!userId,
  });
