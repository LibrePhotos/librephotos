import type { MoveRefusalReason, RenamePreviewResponse } from "@librephotos/api-client";
import { Alert, Loader, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { UndatedPhotos } from "./UndatedPhotos";

const REFUSAL_KEYS: Readonly<Record<MoveRefusalReason, ParseKeys>> = {
  nextcloud: "renamephotos.refused.nextcloud",
  shared_file: "renamephotos.refused.shared_file",
  not_on_disk: "renamephotos.refused.not_on_disk",
};

type Props = Readonly<{
  preview: RenamePreviewResponse | undefined;
  /** The preview is being read for the pattern typed. */
  loading: boolean;
  /** Why the server refused the pattern, or could not be asked. */
  error: string | null;
  /** Dates were given to undated photos: read the preview again. */
  onDated: () => void;
}>;

/** What a rename will do, in counts: the photos that get a new name, and those that keep theirs and why. */
export function RenamePreviewSummary({ preview, loading, error, onDated }: Props) {
  const { t } = useTranslation();
  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />} p="xs">
        {error}
      </Alert>
    );
  }
  if (loading || !preview) return <Loader size="xs" aria-label={t("renamephotos.checking")} />;
  return (
    <Stack gap={4} aria-live="polite">
      <Text size="sm">{t("renamephotos.summary", { count: preview.photos, files: preview.files })}</Text>
      {preview.unchanged > 0 && (
        <Text size="sm" c="dimmed">
          {t("renamephotos.unchanged", { count: preview.unchanged })}
        </Text>
      )}
      {preview.numbered > 0 && (
        <Text size="sm" c="dimmed">
          {t("renamephotos.numbered", { count: preview.numbered })}
        </Text>
      )}
      {preview.undated > 0 && (
        <UndatedPhotos
          message={t("renamephotos.undated", { count: preview.undated })}
          imageHashes={preview.undated_hashes}
          onDated={onDated}
        />
      )}
      {preview.no_free_name > 0 && (
        <Text size="sm" c="orange">
          {t("renamephotos.nofreename", { count: preview.no_free_name })}
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
