import { Avatar, Badge } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { firstName, personName } from "./libraryShareFields";
import { useLibraryShares } from "./useLibraryShares";

/** Beside the timeline's title (#2731): whose libraries it shows besides mine. */
export function TimelineLibrariesNote() {
  const { t } = useTranslation();
  const { received } = useLibraryShares();
  const shown = received.filter(share => share.show_in_timeline);
  const first = shown[0];
  if (!first) return null;
  return (
    <Badge
      variant="light"
      color="gray"
      tt="none"
      leftSection={<Avatar size={16} radius="xl" name={personName(first.owner)} color="initials" />}
    >
      {t("librarySharing.includingLibraries", { names: shown.map(share => firstName(share.owner)).join(", ") })}
    </Badge>
  );
}
