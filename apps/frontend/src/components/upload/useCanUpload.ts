import { useGetSettingsQuery } from "../../api_client/settings";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

/**
 * Whether this user can upload: "off" when the admin turned uploads off (no
 * upload UI at all), "no_scan_directory" when the account has nowhere to save
 * them (the UI explains that), "ready" otherwise. The header button and the
 * window-wide drop target both ask here.
 */
export type UploadAvailability = "off" | "no_scan_directory" | "ready";

export function useCanUpload(): UploadAvailability {
  const { data: settings } = useGetSettingsQuery();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  if (!settings?.allow_upload) return "off";
  return user?.scan_directory?.trim() ? "ready" : "no_scan_directory";
}
