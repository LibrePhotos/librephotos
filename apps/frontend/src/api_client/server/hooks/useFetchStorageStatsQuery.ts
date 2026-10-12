import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { serverKeys } from "../keys";

const StorageStatsResponse = z.object({
  total_storage: z.number(),
  used_storage: z.number(),
  free_storage: z.number(),
});

type StorageStatsResponse = z.infer<typeof StorageStatsResponse>;

export const useFetchStorageStatsQuery = () =>
  useQuery({
    queryKey: serverKeys.storageStats(),
    queryFn: async () => {
      const response = await fetchClient.get("/storagestats/");
      return parseWithNotification(StorageStatsResponse, response, "Failed to parse storage stats");
    },
  });
