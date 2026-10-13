import { endpoints, folderKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchDirsQuery = (path: string | null | undefined) =>
  useQuery({
    queryKey: folderKeys.dirTree(path ?? ""),
    // No path lists the data root ("undefined" is never sent: 403).
    queryFn: () => endpoints.fetchDirTree(apiClient, path ?? ""),
  });
