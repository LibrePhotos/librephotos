import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mediaKeys } from "../keys";

/** Ask the backend why serving this original just failed. Administrators only.
 *
 * Deliberately opt-in through `enabled`: the answer is only meaningful once a
 * media request has actually come back 403, and it costs a handful of `stat`
 * calls on the server, so nothing should ask speculatively.
 */
export const useMediaDiagnosticsQuery = (mediaHash: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: mediaKeys.diagnostics(mediaHash),
    // `enabled` holds the query back until there is a hash; "" would ask for /media/diagnostics//.
    queryFn: () => endpoints.fetchMediaDiagnostics(apiClient, mediaHash ?? ""),
    enabled: enabled && !!mediaHash,
    retry: false,
    staleTime: 0,
  });
