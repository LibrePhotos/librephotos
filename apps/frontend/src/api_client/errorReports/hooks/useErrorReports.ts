import { endpoints, errorReportKeys } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/**
 * The saved error reports (#2938), newest first, at most 30. Admins only: pass `enabled: false`
 * for everyone else, whom the server refuses.
 */
export const useErrorReportsQuery = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: errorReportKeys.list(),
    queryFn: () => endpoints.fetchErrorReports(apiClient),
    enabled,
  });

function useRefreshReports() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: errorReportKeys.all });
}

/** Send once: one report to the chosen server, or to the maintainers while reporting is off. */
export const useSendErrorReportMutation = (options: MutationErrorOptions = {}) => {
  const refresh = useRefreshReports();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (reportId: number) => endpoints.sendErrorReport(apiClient, reportId),
    onSettled: refresh,
  });
};

/** Send all: every report not sent yet. */
export const useSendAllErrorReportsMutation = (options: MutationErrorOptions = {}) => {
  const refresh = useRefreshReports();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: () => endpoints.sendAllErrorReports(apiClient),
    onSettled: refresh,
  });
};

export const useDeleteErrorReportMutation = () => {
  const refresh = useRefreshReports();
  return useMutation({
    mutationFn: (reportId: number) => endpoints.deleteErrorReport(apiClient, reportId),
    onSuccess: refresh,
  });
};

export const useDeleteAllErrorReportsMutation = () => {
  const refresh = useRefreshReports();
  return useMutation({
    mutationFn: () => endpoints.deleteAllErrorReports(apiClient),
    onSuccess: refresh,
  });
};

/** The file name Download saves a report under (errorreports.email_body names it too). */
const errorReportFileName = (reportId: number) => `librephotos-error-report-${reportId}.json`;

/** Download: save one report's event, exactly as it would be sent, as a JSON file. */
export async function saveErrorReportFile(reportId: number): Promise<void> {
  const blob = await endpoints.downloadErrorReport(apiClient, reportId);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = errorReportFileName(reportId);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
