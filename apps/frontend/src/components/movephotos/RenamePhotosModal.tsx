import type { RenamePreviewResponse } from "@librephotos/api-client";
import { ApiError } from "@librephotos/api-client";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRenamePhotosMutation } from "../../api_client/photos/hooks/useRenamePhotosMutation";
import { useRenamePreviewQuery } from "../../api_client/photos/hooks/useRenamePreviewQuery";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { DisabledReason } from "../common/DisabledReason";
import { NAME_PRESETS } from "./namePatterns";
import { RenamePatternField } from "./RenamePatternField";
import { makeRenamePhotosSchema, type RenamePhotosValues } from "./RenamePhotosModal.schema";
import { RenamePreviewSummary } from "./RenamePreviewSummary";
import { RenamePreviewTable } from "./RenamePreviewTable";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The selected photos, as the bulk photo actions name them. */
  selection: PhotoSelection;
  /** The photos were renamed: the selection is done with. */
  onDone?: () => void;
}>;

type BodyProps = Omit<Props, "opened">;

// How long the pattern rests before the server is asked what a rename with it would do.
const PREVIEW_DELAY_MS = 300;
// Up to this many photos are renamed within the request; more run as a job (backend SYNC_MOVE_LIMIT).
const SYNC_RENAME_LIMIT = 100;

/** Every photo of the selection the preview counted. */
const totalOf = (preview: RenamePreviewResponse): number =>
  preview.photos +
  preview.unchanged +
  preview.undated +
  preview.no_free_name +
  preview.refused.reduce((sum, { photos }) => sum + photos, 0);

type PreviewState = { pending: boolean; error: string | null; photos: number | undefined };

/** Why Rename cannot run yet, or false. */
function renameBlocked(t: TFunction, valid: boolean, preview: PreviewState): string | false {
  if (!valid) return t("renamephotos.enterpattern");
  if (preview.pending) return t("renamephotos.checking");
  if (preview.error) return preview.error;
  if (preview.photos === 0) return t("renamephotos.nothingtorename");
  return false;
}

function RenamePhotosBody({ selection, onClose, onDone }: BodyProps) {
  const { t } = useTranslation();
  const initialValues: RenamePhotosValues = { pattern: NAME_PRESETS.datetime };
  const form = useForm({
    initialValues,
    validate: schemaResolver(makeRenamePhotosSchema(t), { sync: true }),
    // Say what is wrong with the pattern while it is typed: there is no submit to wait for.
    validateInputOnChange: true,
  });
  const pattern = form.getValues().pattern;
  const valid = form.isValid();
  const [settled] = useDebouncedValue(pattern, PREVIEW_DELAY_MS);
  const preview = useRenamePreviewQuery(selection, valid && settled === pattern ? pattern : null);
  const rename = useRenamePhotosMutation();

  const pending = valid && (settled !== pattern || preview.isFetching);
  const error = preview.isError
    ? ((preview.error instanceof ApiError ? preview.error.serverMessage : null) ?? t("renamephotos.checkfailed"))
    : null;
  const data = pending ? undefined : preview.data;
  const total = data ? totalOf(data) : 0;
  const reason = renameBlocked(t, valid, { pending, error, photos: data?.photos });
  const submit = form.onSubmit(() =>
    rename.mutate(
      { selection, pattern },
      {
        onSuccess: () => {
          onClose();
          onDone?.();
        },
      }
    )
  );

  return (
    <Stack gap="sm">
      <div>
        <Text size="sm" fw={500}>
          {t("renamephotos.name")}
        </Text>
        <Text size="xs" c="dimmed" mb={6}>
          {t("renamephotos.namehint")}
        </Text>
        <RenamePatternField form={form} />
      </div>
      {valid && data && <RenamePreviewTable rows={data.rows} total={total} />}
      {valid && (
        <RenamePreviewSummary preview={data} loading={pending} error={error} onDated={() => void preview.refetch()} />
      )}
      {total > SYNC_RENAME_LIMIT && (
        <Text size="sm" c="dimmed">
          {t("renamephotos.background")}
        </Text>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          {t("cancel")}
        </Button>
        <DisabledReason reason={reason}>
          <Button onClick={() => submit()} loading={rename.isPending}>
            {t("renamephotos.rename", { count: data?.photos ?? 0 })}
          </Button>
        </DisabledReason>
      </Group>
      <Text size="xs" c="dimmed">
        {t("renamephotos.filesnote")}
      </Text>
    </Stack>
  );
}

/**
 * "Rename files…" for the selected photos (#2773): a name made from each photo's capture date, a
 * preview of the new names, then the rename. A photo is renamed with all its files (RAW and JPEG
 * variants, a Live Photo's video, XMP sidecars) in its own folder; a taken name gets " (1)".
 * Nothing is overwritten. Over a hundred photos run as a job, followed by a toast.
 */
export function RenamePhotosModal({ opened, ...props }: Props) {
  const { t } = useTranslation();
  const isPhone = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal
      opened={opened}
      onClose={props.onClose}
      title={t("renamephotos.title")}
      size="lg"
      fullScreen={isPhone}
      centered
    >
      {opened && <RenamePhotosBody {...props} />}
    </Modal>
  );
}
