import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { statsKeys } from "../keys";
import { CountStats } from "../types";

export const useFetchCountStatsQuery = () =>
  useQuery({
    queryKey: statsKeys.counts(),
    queryFn: async () => {
      const response = await fetchClient.get("/stats/");
      return parseWithNotification(CountStats, response, "Failed to parse count stats");
    },
  });
