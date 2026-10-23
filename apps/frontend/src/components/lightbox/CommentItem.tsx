import type { AlbumComment } from "@librephotos/api-client";
import { ActionIcon, Group, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAlbumCommentMutations } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { parseInstant } from "../../util/dateUtils";
import { ConfirmModal } from "../modals/ConfirmModal";
import { sharerName } from "../sharing/sharerGroups";
import classes from "./AlbumThreadSection.module.css";
import { CommentForm } from "./CommentForm";

type Props = Readonly<{ comment: AlbumComment; albumId: string; photoId: string }>;

/**
 * One comment (#262): who wrote it and when, its text as plain text (never markup), and Edit for
 * its author, Delete for its author or the album's owner.
 */
export function CommentItem({ comment, albumId, photoId }: Props) {
  const { t } = useTranslation();
  const { edit, remove } = useAlbumCommentMutations({ albumId, photoId });
  const [editing, editor] = useDisclosure(false);
  const [deleteOpened, deleteDialog] = useDisclosure(false);
  const author = sharerName(comment.author, comment.author.username);
  const when = parseInstant(comment.created_at).toRelative();

  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={600} truncate>
          {author}{" "}
          <Text span size="xs" c="dimmed" fw={400}>
            {when}
            {comment.edited_at && ` · ${t("collab.edited")}`}
          </Text>
        </Text>
        {(comment.can_edit || comment.can_delete) && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t("collab.commentActions")}>
                <IconDotsVertical size={ICON_SIZE.menu} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {comment.can_edit && (
                <Menu.Item leftSection={<IconPencil size={ICON_SIZE.menu} />} onClick={editor.open}>
                  {t("collab.edit")}
                </Menu.Item>
              )}
              {comment.can_delete && (
                <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={deleteDialog.open}>
                  {t("collab.delete")}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {editing ? (
        <CommentForm
          initialText={comment.text}
          submitLabel={t("collab.save")}
          loading={edit.isPending}
          onCancel={editor.close}
          onSubmit={text => edit.mutate({ commentId: comment.id, text }, { onSuccess: editor.close })}
        />
      ) : (
        <Text size="sm" className={classes.text}>
          {comment.text}
        </Text>
      )}
      <ConfirmModal
        opened={deleteOpened}
        onClose={deleteDialog.close}
        onConfirm={() => remove.mutate(comment.id, { onSuccess: deleteDialog.close })}
        loading={remove.isPending}
        title={t("collab.deleteTitle")}
        message={t("collab.deleteMessage")}
        confirmLabel={t("collab.delete")}
      />
    </Stack>
  );
}
