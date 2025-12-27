import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import type { UserList } from "../types";
import { User } from "../types";

export const UserListQueryKeys = ["userList"] as const;

export const UserListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(User),
});
// User List Query
export const useFetchUserListQuery = () =>
  useQuery<UserList>({
    queryKey: UserListQueryKeys,
    queryFn: async () => {
      const response = await fetchClient.get<UserList>("/user/");
      return parseWithNotification(UserListResponse, response, "Failed to parse user list").results;
    },
  });
