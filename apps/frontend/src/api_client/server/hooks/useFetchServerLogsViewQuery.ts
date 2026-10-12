import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { serverKeys } from "../keys";

const ServerLogsViewResponse = z.object({
  logs: z.string(),
  count: z.number(),
});

type ServerLogsViewResponse = z.infer<typeof ServerLogsViewResponse>;

export const useFetchServerLogsViewQuery = (lines: number) =>
  useQuery({
    queryKey: serverKeys.logs(lines),
    queryFn: async () => {
      const response = await apiClient.get(`/serverlogs/view?lines=${lines}`);
      return parseWithNotification(ServerLogsViewResponse, response, "Failed to parse server logs");
    },
  });
