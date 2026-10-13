import type { SiteSettings } from "@librephotos/api-client";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/settings/hooks";
import { notification } from "../../service/notifications";

/**
 * Saves site settings as they change. Each save is confirmed; the fixed toast id keeps a quick run
 * of toggles from stacking up toasts. A refused save is toasted by the QueryClient, and reloading
 * the settings puts the control back where the server has it (#2222): `SiteSettings` re-reads
 * them whenever they were fetched again, even unchanged.
 */
export function useSaveSiteSettings() {
  const { t } = useTranslation();
  const { refetch } = useGetSettingsQuery();
  const { mutate } = useUpdateSettingsMutation();

  return useCallback(
    (input: Partial<SiteSettings>) =>
      mutate(input, {
        onSuccess: () => notification.success(t("sitesettings.saved"), { id: "site-settings-saved", autoClose: 1500 }),
        onError: () => void refetch(),
      }),
    [mutate, refetch, t]
  );
}
