import { endpoints, pollWhile, serverKeys, type UpdateStatus } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** The built-in updater's states in which something happens (#2788): the status is followed then. */
const INSTALL_BUSY = new Set(["downloading", "verifying", "extracting", "restarting"]);

/** The Windows app is downloading, checking, unpacking or restarting into an update. */
export function isInstallingUpdate(status: UpdateStatus): boolean {
  return INSTALL_BUSY.has(status.install?.state ?? "");
}

/**
 * The daily update check's result (#2311), and the Windows app's updater (#2788), which is
 * followed while it works. Admins only: pass `enabled: false` for everyone else, whom the server
 * refuses. Otherwise the server only reads what it stored, so an hour of staleness is fine.
 */
export const useUpdateStatusQuery = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: serverKeys.updates(),
    queryFn: () => endpoints.fetchUpdateStatus(apiClient),
    staleTime: 60 * 60 * 1000,
    refetchInterval: pollWhile(isInstallingUpdate, false),
    enabled,
  });

/**
 * Reloads the page once the server runs the release it restarted into (#2788), so the new
 * release's web app loads. While it restarts, BackendStatusGate covers the page and keeps it
 * mounted.
 */
function useReloadAfterRestart(status: UpdateStatus | undefined) {
  const [target, setTarget] = useState<string | null>(null);
  const restartingTo = status?.install?.state === "restarting" ? status.install.version : null;
  if (restartingTo !== null && restartingTo !== target) {
    setTarget(restartingTo);
  }
  const current = status?.current;
  useEffect(() => {
    if (target !== null && current === target) {
      window.location.reload();
    }
  }, [target, current]);
}

/** The newer release an admin should hear about (the card and the sidebar dot); null otherwise. */
export function useUpdateNotice(isAdmin: boolean): UpdateStatus | null {
  const { data } = useUpdateStatusQuery({ enabled: isAdmin });
  useReloadAfterRestart(data);
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

/** Download update (Windows app, #2788): fetch, check and unpack `version` in the background. */
export const useInstallUpdateMutation = () => {
  const store = useStoreUpdateStatus();
  return useMutation({
    mutationFn: (version: string) => endpoints.installUpdate(apiClient, version),
    onSuccess: store,
  });
};

/** Restart to update (Windows app, #2788); `true` restarts even while a job runs. */
export const useRestartToUpdateMutation = (options: MutationErrorOptions = {}) => {
  const store = useStoreUpdateStatus();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (force: boolean) => endpoints.restartToUpdate(apiClient, force),
    onSuccess: store,
  });
};
