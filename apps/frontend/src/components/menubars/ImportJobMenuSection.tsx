import type { ImportJob } from "@librephotos/api-client";
import { Group, Menu, Progress, Stack, Text } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { importCounts } from "../upload/uploadProcessing";

/** Share of the uploads the server has made ready, 0-100, or null before it has counted any. */
export function importPercent(imports: ImportJob[]): number | null {
  const { ready, total } = importCounts(imports);
  return total > 0 ? (ready / total) * 100 : null;
}

type Props = Readonly<{
  // The user's unfinished import jobs, from this browser and other devices.
  imports: ImportJob[];
}>;

/**
 * "Importing your uploads" at the top of the account menu while the server processes uploads (#2739),
 * also after the upload card was closed and for the phone's backups. Its own section, beside the
 * running job: an import never holds the queue, and it has no Cancel (it finishes by itself).
 */
export function ImportJobMenuSection({ imports }: Props) {
  const { t } = useTranslation();
  const { ready, total } = importCounts(imports);
  const percent = importPercent(imports) ?? 0;
  return (
    <>
      <Stack gap={6} px="sm" py="xs" data-testid="import-job-section">
        <Group gap={6} wrap="nowrap">
          <IconUpload size={14} />
          <Text size="sm" fw={500}>
            {t("topmenu.importing")}
          </Text>
        </Group>
        <Progress.Root size="sm" aria-label={t("topmenu.importing")}>
          <Progress.Section
            value={percent}
            color="green"
            aria-label={t("topmenu.importingprogress", { ready, total })}
          />
          <Progress.Section value={100 - percent} color="blue" />
        </Progress.Root>
        <Text size="xs" c="dimmed">
          {t("topmenu.importingprogress", { ready, total })}
        </Text>
      </Stack>
      <Menu.Divider />
    </>
  );
}
