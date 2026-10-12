import { fetchAllPages } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { userKeys } from "../keys";
import type { ListUserList } from "../types";
import { ListUser } from "../types";

// Non-admins receive the public-safe subset, so validate each row leniently
// (see ListUser) instead of against the full User schema (issue #1888).
export const UserListRows = z.array(ListUser);
// User List Query
export const useFetchUserListQuery = (skip: boolean = false) =>
  useQuery<ListUserList>({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const rows = await fetchAllPages(apiClient, "/user/");
      return parseWithNotification(UserListRows, rows, "Failed to parse user list");
    },
    enabled: !skip,
  });
