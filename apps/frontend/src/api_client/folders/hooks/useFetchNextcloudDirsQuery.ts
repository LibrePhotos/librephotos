import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { DirTreeResponse } from "../types";

export const NextcloudDirsQueryKeys = ["nextcloudDirs"] as const;

export const useFetchNextcloudDirsQuery = () =>
  useQuery({
    queryKey: [...NextcloudDirsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/nextcloud/listdir/?fpath=/");
      return parseWithNotification(DirTreeResponse, response, "Failed to parse nextcloud directories");
    },
  });
