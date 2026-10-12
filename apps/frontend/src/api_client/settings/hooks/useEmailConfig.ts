import { endpoints, type EmailConfigUpdate } from "@librephotos/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { settingsKeys } from "../keys";

export type { EmailConfigUpdate } from "@librephotos/api-client";

export const useGetEmailConfigQuery = () =>
  useQuery({
    queryKey: settingsKeys.emailConfig(),
    queryFn: () => endpoints.fetchEmailConfig(apiClient),
  });

export const useUpdateEmailConfigMutation = () =>
  useMutation({
    mutationFn: (config: EmailConfigUpdate) => endpoints.updateEmailConfig(apiClient, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.emailConfig() });
      // The forgot-password link visibility depends on email_configured.
      queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    },
  });

/** Sends a test email. A failed send is an ApiError (502, code email_send_failed). */
export const useSendTestEmailMutation = () =>
  useMutation({
    mutationFn: (to?: string) => endpoints.sendTestEmail(apiClient, to),
  });
