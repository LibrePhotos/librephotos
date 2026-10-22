import { endpoints, serverKeys, type UpdateStatus } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * The daily update check's result (#2311). Admins only: pass `enabled: false` for everyone else,
 * whom the server refuses. The server only reads what it stored, so an hour of staleness is fine.
 */
export const useUpdateStatusQuery = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: serverKeys.updates(),
    queryFn: () => endpoints.fetchUpdateStatus(apiClient),
    staleTime: 60 * 60 * 1000,
    enabled,
  });

/** The newer release an admin should hear about (the card and the sidebar dot); null otherwise. */
export function useUpdateNotice(isAdmin: boolean): UpdateStatus | null {
  const { data } = useUpdateStatusQuery({ enabled: isAdmin });
  return isAdmin && data?.notice ? data : null;
}

function useStoreUpdateStatus() {
  const queryClient = useQueryClient();
  return (status: UpdateStatus) => queryClient.setQueryData(serverKeys.updates(), status);
}

/** Skip this release; `""` shows the newest release again. */
export const useSkipReleaseMutation = () => {
  const store = useStoreUpdateStatus();
  return useMutation({
    mutationFn: (version: string) => endpoints.skipRelease(apiClient, version),
    onSuccess: store,
  });
};

/** Close the Update available card for a week. */
export const useSnoozeUpdateNoticeMutation = () => {
  const store = useStoreUpdateStatus();
  return useMutation({
    mutationFn: () => endpoints.snoozeUpdateNotice(apiClient),
    onSuccess: store,
  });
};
