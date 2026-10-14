import { Box, Group, Stack, Text } from "@mantine/core";
import type { MantineSpacing } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import type { TrashExpiry } from "../../util/trashRetention";
import { TRASH_EXPIRY_WARNING_DAYS, trashExpiry } from "../../util/trashRetention";

type Props = Readonly<{ trashedAt: string | null | undefined }>;

/** When the trashed photo goes, by the site's trash retention; null without a trashed-on date. */
function useTrashExpiry(trashedAt: string | null | undefined): TrashExpiry | null {
  const { data: settings } = useGetSettingsQuery();
  return trashExpiry(trashedAt, settings?.trash_retention_days, DateTime.now());
}

const isUrgent = (expiry: TrashExpiry) => expiry.daysLeft !== null && expiry.daysLeft <= TRASH_EXPIRY_WARNING_DAYS;

function ExpiryLines({ expiry, mb }: Readonly<{ expiry: TrashExpiry; mb?: MantineSpacing }>) {
  const { t } = useTranslation();
  const { deletedOn, daysLeft } = expiry;
  return (
    <Stack gap={0} mb={mb}>
      <Text size="sm" fw={600}>
        {t("trash.trashedOn", { date: expiry.trashedOn.toLocaleString(DateTime.DATE_MED) })}
      </Text>
      {deletedOn && daysLeft !== null && (
        <Text size="xs" c={isUrgent(expiry) ? "red" : "dimmed"}>
          {daysLeft > 0
            ? t("trash.deletedIn", { count: daysLeft, date: deletedOn.toLocaleString(DateTime.DATE_MED) })
            : t("trash.deletedNext")}
        </Text>
      )}
    </Stack>
  );
}

/** "Moved to the trash on ..." and, with the retention on, when it is deleted for good (#2203). */
export function TrashExpiryText({ trashedAt, mb }: Props & Readonly<{ mb?: MantineSpacing }>) {
  const expiry = useTrashExpiry(trashedAt);
  return expiry ? <ExpiryLines expiry={expiry} mb={mb} /> : null;
}

/** The lightbox info row of a trashed photo, laid out like the date row above it. */
export function TrashedItem({ trashedAt }: Props) {
  const expiry = useTrashExpiry(trashedAt);
  if (!expiry) return null;
  return (
    <Group wrap="nowrap">
      {/* The icon takes the text colour: red once the photo is about to go. */}
      <Box component="span" c={isUrgent(expiry) ? "red" : undefined} lh={0}>
        <IconTrash />
      </Box>
      <ExpiryLines expiry={expiry} />
    </Group>
  );
}
