import type { MoveOnConflict } from "@librephotos/api-client";
import { ApiError } from "@librephotos/api-client";
import { Button, Group, Modal, Paper, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { IconFolderPlus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { isNameConflict, useMovePhotosMutation } from "../../api_client/photos/hooks/useMovePhotosMutation";
import { useMovePreviewQuery } from "../../api_client/photos/hooks/useMovePreviewQuery";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { childPath, folderName } from "../../util/folderPaths";
import { DisabledReason } from "../common/DisabledReason";
import { MoveConflictModal } from "./MoveConflictModal";
import { MoveFolderTree, type NewFolder } from "./MoveFolderTree";
import classes from "./MovePhotosModal.module.css";
import { makeMovePhotosSchema, type MovePhotosValues } from "./MovePhotosModal.schema";
import { MovePreviewSummary } from "./MovePreviewSummary";
import { NewFolderForm } from "./NewFolderForm";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The selected photos, as the bulk photo actions name them. */
  selection: PhotoSelection;
  /** The photos moved: the selection is done with. */
  onDone?: () => void;
  /** The folder the photos are in, when they are all in one (the photo page). */
  currentFolder?: string;
}>;

type BodyProps = Omit<Props, "opened">;

// How long the destination rests before the server is asked what a move there would do.
const PREVIEW_DELAY_MS = 300;

type PreviewState = { pending: boolean; error: unknown; photos: number | undefined };

/** Why Move cannot run yet, or false. */
function moveBlocked(t: TFunction, valid: boolean, preview: PreviewState): string | false {
  if (!valid) return t("movephotos.pickfolder");
  if (preview.pending) return t("movephotos.checking");
  if (preview.error) return t("movephotos.folderrefused");
  if (preview.photos === 0) return t("movephotos.nothingtomove");
  return false;
}

const serverMessage = (error: unknown): string | null => (error instanceof ApiError ? error.serverMessage : null);

function MovePhotosBody({ selection, onClose, onDone, currentFolder }: BodyProps) {
  const { t } = useTranslation();
  const initialValues: MovePhotosValues = { target: "" };
  const form = useForm({
    initialValues,
    validate: schemaResolver(makeMovePhotosSchema(t), { sync: true }),
  });
  const target = form.getValues().target.trim();
  const valid = form.isValid();
  const [settled] = useDebouncedValue(target, PREVIEW_DELAY_MS);
  const preview = useMovePreviewQuery(selection, valid && settled === target ? target : null);
  const move = useMovePhotosMutation();
  const [conflictOpened, conflict] = useDisclosure(false);
  const [naming, newFolder] = useDisclosure(false);
  const [newFolders, setNewFolders] = useState<NewFolder[]>([]);

  const run = (onConflict?: MoveOnConflict) =>
    move.mutate(
      { selection, targetFolder: target, onConflict },
      {
        onSuccess: () => {
          conflict.close();
          onClose();
          onDone?.();
        },
        // A name taken since the preview was read: ask about it now.
        onError: error => {
          if (!isNameConflict(error)) return;
          void preview.refetch();
          conflict.open();
        },
      }
    );
  const submit = form.onSubmit(() => {
    if (preview.data && preview.data.clashes.length > 0) conflict.open();
    else run();
  });
  const addFolder = (name: string) => {
    const path = childPath(target, name);
    setNewFolders(previous => [...previous, { parent: target, path, name }]);
    form.setFieldValue("target", path);
    newFolder.close();
  };
  const pending = valid && (settled !== target || preview.isFetching);
  const error = preview.isError ? (serverMessage(preview.error) ?? t("movephotos.checkfailed")) : null;
  const reason = moveBlocked(t, valid, { pending, error, photos: preview.data?.photos });

  return (
    <Stack gap="sm">
      <TextInput
        label={t("movephotos.destination")}
        description={t("movephotos.destinationhint")}
        {...form.getInputProps("target")}
      />
      <Paper withBorder radius="sm" p={4}>
        {/* Not a ScrollArea: its table layout lets a long folder name widen the tree instead of truncating. */}
        <div className={classes.scroller}>
          <MoveFolderTree
            selected={target}
            onSelect={path => form.setFieldValue("target", path)}
            currentFolder={currentFolder}
            newFolders={newFolders}
          />
        </div>
      </Paper>
      {naming ? (
        <NewFolderForm parent={valid ? target : null} onCreate={addFolder} onCancel={newFolder.close} />
      ) : (
        <Group>
          <DisabledReason reason={!valid && t("movephotos.pickparent")}>
            <Button variant="subtle" size="xs" leftSection={<IconFolderPlus size={14} />} onClick={newFolder.open}>
              {t("movephotos.newfolder")}
            </Button>
          </DisabledReason>
        </Group>
      )}
      <MovePreviewSummary preview={pending ? undefined : preview.data} loading={pending} error={error} />
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          {t("cancel")}
        </Button>
        <DisabledReason reason={reason}>
          <Button onClick={() => submit()} loading={move.isPending && !conflictOpened}>
            {t("movephotos.move", { count: preview.data?.photos ?? 0 })}
          </Button>
        </DisabledReason>
      </Group>
      <Text size="xs" c="dimmed">
        {t("movephotos.filesnote")}
      </Text>
      <MoveConflictModal
        opened={conflictOpened}
        onClose={conflict.close}
        clashes={preview.data?.clashes ?? []}
        folderName={folderName(target)}
        onChoose={run}
        moving={move.isPending}
      />
    </Stack>
  );
}

/**
 * "Move to folder…" for the selected photos (#352): pick a folder of the library (or name a new
 * one), see what the move will do, then move. A photo moves with all its files: RAW and JPEG
 * variants, a Live Photo's video and its XMP sidecars. Taken names are asked about next
 * (`MoveConflictModal`); nothing is ever overwritten.
 */
export function MovePhotosModal({ opened, ...props }: Props) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={props.onClose} title={t("movephotos.title")} size="lg" centered>
      {opened && <MovePhotosBody {...props} />}
    </Modal>
  );
}
