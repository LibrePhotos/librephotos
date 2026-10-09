import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

/**
 * A regular user an admin has not given a scan folder yet. Only an admin can
 * set it, so "Go to Library" would be a dead end for them.
 */
export function useHasNoScanDirectory(): boolean {
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  return !!auth?.access && !auth.access.is_admin && !!userSelfDetails && !userSelfDetails.scan_directory;
}

/**
 * The text and button of an empty photo list that scanning would fill: Library,
 * or what others shared for a user without a scan folder.
 */
export function useScanEmptyStateAction(description: string) {
  const { t } = useTranslation();
  const hasNoScanDirectory = useHasNoScanDirectory();
  return useMemo(
    () =>
      hasNoScanDirectory
        ? {
            description: t("emptystate.photos.noscandirectory"),
            actionLabel: t("sidemenu.sharedwithyou"),
            actionLink: "/sharing/withme/albums",
          }
        : { description, actionLabel: t("emptystate.goToLibrary"), actionLink: "/library" },
    [t, hasNoScanDirectory, description]
  );
}
