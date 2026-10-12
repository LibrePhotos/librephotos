import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { folderKeys } from "../keys";
import { DirTreeResponse } from "../types";

export const useFetchNextcloudDirsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: folderKeys.nextcloudDirs(),
    queryFn: async () => {
      const response = await fetchClient.get("/nextcloud/listdir/?fpath=/");
      return parseWithNotification(DirTreeResponse, response, "Failed to parse nextcloud directories");
    },
    enabled: !skip,
  });
