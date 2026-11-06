import { ActionIcon, Box } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

/** Whether a path is a page below a hub (an album, a person, an event, a search…). */
export function isDetailPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "album") return segments.length >= 3;
  return segments.length >= 2 && ["search", "sharing", "jobs"].includes(segments[0] ?? "");
}

/** Where a detail page goes back to without history: its path one level up. */
function parentOf(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "/";
}

/**
 * The round back chevron before a detail page's title on a desktop, as Apple and Immich give every
 * drilled-in view a way back besides the browser's (phones have the header's back arrow). It reads
 * the location directly, so the header also works outside the router (tests, public pages).
 */
export function DetailBackButton() {
  const { t } = useTranslation();
  const { pathname } = window.location;
  if (!isDetailPath(pathname)) return null;
  return (
    <Box visibleFrom="sm" display="flex">
      <ActionIcon
        variant="subtle"
        color="gray"
        size={32}
        radius="xl"
        aria-label={t("back")}
        onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign(parentOf(pathname)))}
      >
        <IconChevronLeft size={20} stroke={1.75} />
      </ActionIcon>
    </Box>
  );
}
