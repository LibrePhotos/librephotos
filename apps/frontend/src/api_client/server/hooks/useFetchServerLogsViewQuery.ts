import { endpoints, serverKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchServerLogsViewQuery = (lines: number) =>
  useQuery({
    queryKey: serverKeys.logs(lines),
    queryFn: () => endpoints.fetchServerLogs(apiClient, lines),
  });

/** The whole server log file, for the Download button. */
export const fetchServerLogFile = () => endpoints.fetchServerLogFile(apiClient);
