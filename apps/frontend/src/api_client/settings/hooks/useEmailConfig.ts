import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { EmailConfig } from "../types";
import { SiteSettingsQueryKeys } from "./useGetSettingsQuery";

export const EmailConfigQueryKeys = ["emailConfig"] as const;

export const useGetEmailConfigQuery = () =>
  useQuery({
    queryKey: [...EmailConfigQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/email-config/");
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
      const response = await fetchClient.post("/email-config/", config);
      return parseWithNotification(EmailConfig, response, "Failed to parse email configuration response");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EmailConfigQueryKeys] });
      // The forgot-password link visibility depends on email_configured.
      queryClient.invalidateQueries({ queryKey: [...SiteSettingsQueryKeys] });
    },
  });

export const EmailTestResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

export type EmailTestResponse = z.infer<typeof EmailTestResponse>;

export const useSendTestEmailMutation = () =>
  useMutation({
    mutationFn: async (to?: string) => {
      const response = await fetchClient.post("/email-config/test/", to ? { to } : {});
      return parseWithNotification(EmailTestResponse, response, "Failed to parse test-email response");
    },
  });
