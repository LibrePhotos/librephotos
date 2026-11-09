import { ActionIcon, Box } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useCanGoBack, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";

// The pages the phone's tab bar opens: no way back is needed from these.
const TAB_ROOTS = new Set(["/", "/album", "/sharing"]);

/** The page a sub-page goes back to when there is no history entry: its path one level up. */
export function parentPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "/";
}

/**
 * The back arrow before the search field on a phone, on every page below a tab (an album, a
 * person, Settings…), as Google Photos and Immich give sub-pages a way back besides the tab bar.
 */
export function MobileBackButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const pathname = useRouterState({ select: state => state.location.pathname.replace(/\/$/, "") || "/" });
  if (TAB_ROOTS.has(pathname)) return null;
  return (
    <Box hiddenFrom="sm" display="flex">
      <ActionIcon
        variant="subtle"
        color="gray"
        size={36}
        radius="xl"
        aria-label={t("back")}
        onClick={() => (canGoBack ? router.history.back() : void navigate({ to: parentPath(pathname) }))}
      >
        <IconArrowLeft size={22} stroke={1.75} />
      </ActionIcon>
    </Box>
  );
}
