import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { CountStats } from "../types";

export const CountStatsQueryKeys = ["countStats"] as const;

export const useFetchCountStatsQuery = () =>
  useQuery({
    queryKey: [...CountStatsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/stats/");
      return parseWithNotification(CountStats, response, "Failed to parse count stats");
    },
  });
