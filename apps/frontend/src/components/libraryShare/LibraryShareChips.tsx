import type { LibraryShareSwitches } from "@librephotos/api-client";
import { Badge, Group } from "@mantine/core";
import { IconCalendar } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { LIBRARY_SWITCHES } from "./libraryShareFields";

/**
 * A share's contract in one line (#2731): green for what is shared, grey for what is not, each
 * with its icon and words ("No location"), never colour alone.
 */
export function LibraryShareChips({ switches }: Readonly<{ switches: LibraryShareSwitches }>) {
  const { t } = useTranslation();
  return (
    <Group gap={4}>
      <Badge size="sm" variant="light" color="green" tt="none" leftSection={<IconCalendar size={12} aria-hidden />}>
        {t("librarySharing.chipDates")}
      </Badge>
      {LIBRARY_SWITCHES.map(({ field, icon: Icon, chipOn, chipOff }) => {
        const on = switches[field];
        return (
          <Badge
            key={field}
            size="sm"
            variant="light"
            color={on ? "green" : "gray"}
            tt="none"
            leftSection={<Icon size={12} aria-hidden />}
          >
            {t(on ? chipOn : chipOff)}
          </Badge>
        );
      })}
    </Group>
  );
}
