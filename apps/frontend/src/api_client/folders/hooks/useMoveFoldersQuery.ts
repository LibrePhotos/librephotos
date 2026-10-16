import { endpoints, folderKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * One level of the folders a move can go to (#352): the subfolders of `path`, or with null the
 * library folders themselves. `enabled` false until the folder is opened in the tree.
 */
export const useMoveFoldersQuery = (path: string | null, enabled = true) =>
  useQuery({
    queryKey: folderKeys.moveTargets(path),
    queryFn: () => endpoints.fetchMoveFolders(apiClient, path),
    enabled,
  });
