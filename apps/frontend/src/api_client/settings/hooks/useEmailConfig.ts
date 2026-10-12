import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { settingsKeys } from "../keys";
import { EmailConfig } from "../types";

export const useGetEmailConfigQuery = () =>
  useQuery({
    queryKey: settingsKeys.emailConfig(),
    queryFn: async () => {
      const response = await apiClient.get("/email-config/");
      return parseWithNotification(EmailConfig, response, "Failed to parse email configuration");
    },
  });

export type EmailConfigUpdate = Partial<{
  provider: string;
  from_email: string;
  host: string;
  port: number;
  use_tls: boolean;
  use_ssl: boolean;
  username: string;
  secret: string;
  clear_secret: boolean;
}>;

export const useUpdateEmailConfigMutation = () =>
  useMutation({
    mutationFn: async (config: EmailConfigUpdate) => {
      const response = await apiClient.post("/email-config/", config);
      return parseWithNotification(EmailConfig, response, "Failed to parse email configuration response");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.emailConfig() });
      // The forgot-password link visibility depends on email_configured.
      queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    },
  });

/** A sent test email. A failed send is an ApiError (502, code email_send_failed). */
const EmailTestResponse = z.object({
  status: z.literal(true),
  message: z.string(),
});

type EmailTestResponse = z.infer<typeof EmailTestResponse>;

export const useSendTestEmailMutation = () =>
  useMutation({
    mutationFn: async (to?: string) => {
      const response = await apiClient.post("/email-config/test/", to ? { to } : {});
      return parseWithNotification(EmailTestResponse, response, "Failed to parse test-email response");
    },
  });
