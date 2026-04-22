import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const ServerLogsViewQueryKeys = ["serverLogsView"] as const;

const ServerLogsViewResponse = z.object({
  logs: z.string(),
  count: z.number(),
});

export type ServerLogsViewResponse = z.infer<typeof ServerLogsViewResponse>;

export const useFetchServerLogsViewQuery = (lines: number) =>
  useQuery({
    queryKey: [...ServerLogsViewQueryKeys, lines],
    queryFn: async () => {
      const response = await fetchClient.get(`/serverlogs/view?lines=${lines}`);
      return parseWithNotification(ServerLogsViewResponse, response, "Failed to parse server logs");
    },
  });
