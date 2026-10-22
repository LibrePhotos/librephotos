import type { LibraryFolderEntry } from "@librephotos/api-client";
import { Alert, Button, Checkbox, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useSetExcludedFoldersMutation,
  useTrashOwnPhotosOutsideLibraryMutation,
} from "../../api_client/user/hooks/useExcludedFolders";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { newlyLeftOut, toggleLeftOut } from "./excludedPaths";
import classes from "./LibraryFolderRow.module.css";
import { SubfolderTree } from "./SubfolderTree";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The library folder whose subfolders are shown. */
  folder: LibraryFolderEntry | null;
  /** Every folder left out of the library now, in any library folder. */
  savedExcluded: readonly string[];
  username: string;
}>;

/**
 * Leave subfolders of one library folder out of the own library (#791): a tree with a checkbox per
 * folder, unticked = left out. Saved together; the photos already imported from a folder left out
 * stay until the user moves them to the trash, which the dialog offers.
 */
export function ExcludeSubfoldersModal({ opened, onClose, folder, savedExcluded, username }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string[]>([...savedExcluded]);
  const [trashPhotos, setTrashPhotos] = useState(false);
  const save = useSetExcludedFoldersMutation();
  const trash = useTrashOwnPhotosOutsideLibraryMutation();

  useEffect(() => {
    if (opened) {
      setDraft([...savedExcluded]);
      setTrashPhotos(false);
    }
  }, [opened, savedExcluded]);

  const added = newlyLeftOut(savedExcluded, draft).length > 0;

  const submit = () => {
    save.mutate(draft, {
      onSuccess: saved => {
        if (added && trashPhotos && saved.outside_count > 0) {
          trash.mutate({ username, count: saved.outside_count });
        }
        onClose();
      },
    });
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      onClose={onClose}
      title={t("libraryfolders.leaveouttitle")}
      size="lg"
      centered
    >
      <Stack gap="sm">
        <Text size="sm" ff="monospace" className={classes.path}>
          {folder?.path}
        </Text>
        <Text size="sm" c="dimmed">
          {t("libraryfolders.leaveoutexplanation")}
        </Text>
        <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
          {folder && opened && (
            <SubfolderTree
              path={folder.path}
              excluded={draft}
              onToggle={path => setDraft(toggleLeftOut(draft, path))}
            />
          )}
        </ScrollArea.Autosize>
        {added && (
          <Alert color="orange" variant="light" icon={<IconInfoCircle size={18} />}>
            <Stack gap="xs">
              <Text size="sm">{t("libraryfolders.leaveoutimpact")}</Text>
              <Checkbox
                checked={trashPhotos}
                onChange={event => setTrashPhotos(event.currentTarget.checked)}
                label={t("libraryfolders.leaveouttrash")}
                description={t("scandirectorychange.trashdescription")}
              />
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {t("save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
