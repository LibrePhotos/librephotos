import type { MovePreviewResponse, MoveRefusalReason } from "@librephotos/api-client";
import { Alert, Loader, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";

const REFUSAL_KEYS: Readonly<Record<MoveRefusalReason, ParseKeys>> = {
  nextcloud: "movephotos.refused.nextcloud",
  shared_file: "movephotos.refused.shared_file",
  not_on_disk: "movephotos.refused.not_on_disk",
};

type Props = Readonly<{
  preview: MovePreviewResponse | undefined;
  /** The preview is being read for the folder picked. */
  loading: boolean;
  /** Why the server refused the folder (outside the library, a folder the scan skips, ...). */
  error: string | null;
}>;

/** What moving to the picked folder will do: the photos and files that move, and those that stay. */
export function MovePreviewSummary({ preview, loading, error }: Props) {
  const { t } = useTranslation();
  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />} p="xs">
        {error}
      </Alert>
    );
  }
  if (loading) return <Loader size="xs" aria-label={t("movephotos.checking")} />;
  if (!preview) {
    return (
      <Text size="sm" c="dimmed">
        {t("movephotos.pickfolder")}
      </Text>
    );
  }
  return (
    <Stack gap={4} aria-live="polite">
      <Text size="sm">{t("movephotos.summary", { count: preview.photos, files: preview.files })}</Text>
      {preview.unchanged > 0 && (
        <Text size="sm" c="dimmed">
          {t("movephotos.unchanged", { count: preview.unchanged })}
        </Text>
      )}
      {preview.clashes.length > 0 && (
        <Text size="sm" c="orange">
          {t("movephotos.clashes", { count: preview.clashes.length })}
        </Text>
      )}
      {preview.refused.map(({ reason, photos }) => (
        <Text key={reason} size="sm" c="orange">
          {t(REFUSAL_KEYS[reason], { count: photos })}
        </Text>
      ))}
    </Stack>
  );
}
