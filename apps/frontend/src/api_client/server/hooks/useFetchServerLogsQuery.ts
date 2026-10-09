import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";

export const ServerLogsQueryKeys = ["serverLogs"] as const;

export const useFetchServerLogsQuery = () =>
  useQuery({
    queryKey: [...ServerLogsQueryKeys],
    queryFn: () => fetchClient.get<string[]>(`/serverlogs`),
  });
