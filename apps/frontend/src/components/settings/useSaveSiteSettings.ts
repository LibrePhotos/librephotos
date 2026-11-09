import type { SiteSettingsUpdate } from "@librephotos/api-client";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/settings/hooks";
import { notification } from "../../service/notifications";

/**
 * Saves site settings as they change, and resolves whether the server took the change (it never
 * rejects). Each save is confirmed; the fixed toast id keeps a quick run of toggles from stacking
 * up toasts. A refused save is toasted by the QueryClient and the settings are read again, so a
 * control showing the server's value goes back where the server has it (#2222).
 *
 * Every call settles on its own: a `mutate()` callback only runs for the newest call of a hook,
 * so with two quick saves the first one's never ran.
 */
export function useSaveSiteSettingsAsync() {
  const { t } = useTranslation();
  const { refetch } = useGetSettingsQuery();
  const { mutateAsync } = useUpdateSettingsMutation();

  return useCallback(
    (input: SiteSettingsUpdate): Promise<boolean> =>
      mutateAsync(input).then(
        () => {
          notification.success(t("sitesettings.saved"), { id: "site-settings-saved", autoClose: 1500 });
          return true;
        },
        () => {
          void refetch();
          return false;
        }
      ),
    [mutateAsync, refetch, t]
  );
}

/**
 * `useSaveSiteSettingsAsync` for a fire-and-forget save: `onSaved` runs once the server took it,
 * `onFailed` once it refused it.
 */
export function useSaveSiteSettings() {
  const save = useSaveSiteSettingsAsync();
  return useCallback(
    (input: SiteSettingsUpdate, onSaved?: () => void, onFailed?: () => void) =>
      void save(input).then(saved => (saved ? onSaved?.() : onFailed?.())),
    [save]
  );
}
