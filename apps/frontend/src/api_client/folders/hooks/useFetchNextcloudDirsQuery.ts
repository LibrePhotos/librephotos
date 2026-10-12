import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { folderKeys } from "../keys";

export const useFetchNextcloudDirsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: folderKeys.nextcloudDirs(),
    queryFn: () => endpoints.fetchNextcloudDirs(apiClient),
    enabled: !skip,
  });
