import type { LibraryFolderEntry } from "@librephotos/api-client";
import { Button, Group, Skeleton, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFolderPlus } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLibraryFoldersQuery, type LibraryOwner } from "../../api_client/user/hooks/useLibraryFolders";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { AddLibraryFolderModal } from "./AddLibraryFolderModal";
import { LibraryFolderRow } from "./LibraryFolderRow";
import { RemoveLibraryFolderModal } from "./RemoveLibraryFolderModal";

type Props = Readonly<{
  /** Whose folders are listed: "self" on the Library page, a user's id in the user dialog. */
  owner: LibraryOwner;
  /** The id of that user, for adding and removing. */
  userId: number;
  username: string;
  /** Admins add and remove folders: that needs the server's folder tree (#123). */
  canManage: boolean;
  /** Told when a dialog of this list opens or closes, so a dialog around it keeps Escape for it. */
  onDialogChange?: (opened: boolean) => void;
}>;

/** The folders of a library (#123) as rows, with Add folder and Remove for admins. */
export function LibraryFolderList({ owner, userId, username, canManage, onDialogChange }: Props) {
  const { t } = useTranslation();
  const query = useLibraryFoldersQuery(owner);
  const failure = useListFailure(query);
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [removeOpened, { open: openRemove, close: closeRemove }] = useDisclosure(false);
  const [toRemove, setToRemove] = useState<LibraryFolderEntry | null>(null);
  const dialogOpened = addOpened || removeOpened;
  useEffect(() => {
    onDialogChange?.(dialogOpened);
  }, [dialogOpened, onDialogChange]);

  const askRemove = (folder: LibraryFolderEntry) => {
    setToRemove(folder);
    openRemove();
  };

  return (
    <Stack gap="xs">
      {failure && <ErrorState failure={failure} compact />}
      {query.isPending && !failure && <Skeleton height={52} radius="sm" />}
      {query.data?.folders.length === 0 && (
        <Text size="sm" c="dimmed">
          {t("libraryfolders.none")}
        </Text>
      )}
      {query.data?.folders.map(folder => (
        <LibraryFolderRow
          key={folder.path}
          folder={folder}
          onRemove={canManage ? () => askRemove(folder) : undefined}
        />
      ))}
      {canManage && (
        <Group justify="flex-start">
          {/* The scan directory is the main folder: without it there is no library to add to. */}
          <DisabledReason reason={query.data?.folders.length === 0 && t("libraryfolders.mainfirst")}>
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconFolderPlus size={ICON_SIZE.inline} />}
              onClick={openAdd}
            >
              {t("libraryfolders.add")}
            </Button>
          </DisabledReason>
        </Group>
      )}
      {canManage && (
        <>
          <AddLibraryFolderModal opened={addOpened} onClose={closeAdd} userId={userId} username={username} />
          <RemoveLibraryFolderModal
            opened={removeOpened}
            folder={toRemove}
            onClose={closeRemove}
            userId={userId}
            username={username}
          />
        </>
      )}
    </Stack>
  );
}
