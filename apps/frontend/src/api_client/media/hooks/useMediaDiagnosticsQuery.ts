import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { MediaDiagnostics } from "../types";

export const MediaDiagnosticsQueryKeys = ["mediaDiagnostics"] as const;

/** Ask the backend why serving this original just failed. Administrators only.
 *
 * Deliberately opt-in through `enabled`: the answer is only meaningful once a
 * media request has actually come back 403, and it costs a handful of `stat`
 * calls on the server, so nothing should ask speculatively.
 */
export const useMediaDiagnosticsQuery = (mediaHash: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: [...MediaDiagnosticsQueryKeys, mediaHash],
    queryFn: async () => {
      const response = await fetchClient.get(`/media/diagnostics/${mediaHash}/`);
      return parseWithNotification(MediaDiagnostics, response, "Failed to parse media diagnostics response");
    },
    enabled: enabled && !!mediaHash,
    retry: false,
    staleTime: 0,
  });
