import type { LibraryShare } from "@librephotos/api-client";
import { Avatar, Button, Divider, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconEye } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteLibraryShareMutation, useUpdateLibraryShareMutation } from "../../api_client/libraryShares/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { LibraryPreviewModal } from "./LibraryPreviewModal";
import { firstName, personName, shareDate, switchesOf } from "./libraryShareFields";
import { AlwaysAndNeverShared, LibrarySwitches } from "./LibrarySwitches";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  share: LibraryShare;
}>;

/**
 * "What Ben sees" (#2731): the owner's switches for one recipient, saved at once like the album
 * share switches; a preview of a photo as they see it; and Stop sharing, after a confirmation.
 */
export function LibraryRecipientModal({ opened, onClose, share }: Props) {
  const { t } = useTranslation();
  const fullScreen = useMediaQuery("(max-width: 576px)");
  const update = useUpdateLibraryShareMutation();
  const remove = useDeleteLibraryShareMutation();
  const [previewOpened, preview] = useDisclosure(false);
  const [stopOpened, stopDialog] = useDisclosure(false);
  const name = personName(share.recipient);
  const first = firstName(share.recipient);
  const since = shareDate(share);

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={t("librarySharing.whatSees", { name: first })}
        fullScreen={fullScreen}
        closeOnEscape={!stopOpened && !previewOpened}
      >
        <Stack>
          <Group gap="sm" wrap="nowrap">
            <Avatar radius="xl" name={name} color="initials" />
            <div>
              <Text fw={500}>{name}</Text>
              <Text size="xs" c="dimmed">
                {share.show_in_timeline
                  ? t("librarySharing.inTheirTimeline", { date: since })
                  : t("librarySharing.keptSeparate", { date: since })}
              </Text>
            </div>
          </Group>
          <Text size="xs" c="dimmed">
            {t("librarySharing.readOnlyNote", { name: first })}
          </Text>
          <LibrarySwitches
            values={switchesOf(share)}
            onChange={(field, value) => update.mutate({ shareId: share.id, patch: { [field]: value } })}
          />
          <AlwaysAndNeverShared />
          <Button variant="light" leftSection={<IconEye size={16} />} onClick={preview.open}>
            {t("librarySharing.previewAs", { name: first })}
          </Button>
          <Divider />
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500} c="red">
                  {t("librarySharing.stopSharingWith", { name: first })}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("librarySharing.stopSharingHint")}
                </Text>
              </div>
              <Button color="red" variant="light" onClick={stopDialog.open}>
                {t("librarySharing.stopSharing")}
              </Button>
            </Group>
          </Paper>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("librarySharing.close")}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <LibraryPreviewModal opened={previewOpened} onClose={preview.close} name={first} switches={switchesOf(share)} />
      <ConfirmModal
        opened={stopOpened}
        onClose={stopDialog.close}
        onConfirm={() =>
          remove.mutate(
            { shareId: share.id, side: "owner", name },
            {
              onSuccess: () => {
                stopDialog.close();
                onClose();
              },
            }
          )
        }
        loading={remove.isPending}
        title={t("librarySharing.stopSharingTitle", { name: first })}
        message={t("librarySharing.stopSharingMessage", { name: first })}
        confirmLabel={t("librarySharing.stopSharing")}
      />
    </>
  );
}
