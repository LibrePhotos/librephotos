import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { folderKeys } from "../keys";
import { DirTreeResponse } from "../types";

export const useFetchDirsQuery = (path: string | null | undefined) =>
  useQuery({
    queryKey: folderKeys.dirTree(path ?? ""),
    queryFn: async () => {
      // No path lists the data root. Encoded so "&", "#" or "+" in a folder
      // name do not cut the path short (and "undefined" is never sent: 403).
      const response = await fetchClient.get(`/dirtree/?path=${encodeURIComponent(path ?? "")}`);
      return parseWithNotification(DirTreeResponse, response, "Failed to parse directory tree");
    },
  });
