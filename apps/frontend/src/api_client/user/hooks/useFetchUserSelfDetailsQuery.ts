import { endpoints, type User } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { userKeys } from "../keys";

// User Self Details Query
export const useFetchUserSelfDetailsQuery = (userId: string) =>
  useQuery<User>({
    queryKey: userKeys.selfDetail(userId),
    queryFn: () => endpoints.fetchUserSelfDetails(apiClient, userId),
    enabled: !!userId,
  });
