import { endpoints, type ListUserList } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { userKeys } from "../keys";

// Every page of users. Non-admins receive the public-safe subset, so each row is validated
// leniently (ListUser) instead of against the full User schema (issue #1888).
export const useFetchUserListQuery = (skip: boolean = false) =>
  useQuery<ListUserList>({
    queryKey: userKeys.list(),
    queryFn: () => endpoints.fetchUserList(apiClient),
    enabled: !skip,
  });
