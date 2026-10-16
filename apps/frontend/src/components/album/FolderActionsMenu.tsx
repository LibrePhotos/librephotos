import { Menu, Text, useMantineTheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFaceId as FaceId } from "@tabler/icons-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useDetectFacesAgainMutation } from "../../api_client/faces/hooks/useDetectFacesAgainMutation";
import { useJobQueue } from "../../hooks/useJobQueue";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";

type Props = Readonly<{
  /** The folder, as the server stores its paths. */
  folderPath: string;
  /** Its name, for the dialog's title. */
  folderName: string;
  /** The photos the page shows: this folder and its subfolders. */
  photoCount: number;
}>;

/**
 * The folder page's ⋮ (#524): Detect faces again in this folder and its subfolders. That is a long
 * job, so it asks first, saying what stays and that deleted faces are not found again.
 */
export function FolderActionsMenu({ folderPath, folderName, photoCount }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const noteId = useId();
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const detectFaces = useDetectFacesAgainMutation();
  const queue = useJobQueue();
  const label = t("folderactions.detectfaces");

  return (
    <>
      <HeaderActionsMenu label={t("folderactions.label")}>
        <DisabledReason reason={queue.busy && t("jobs.queuebusy.reason")} position="left">
          <Menu.Item
            leftSection={<FaceId size={ICON_SIZE.menu} />}
            aria-label={label}
            aria-describedby={noteId}
            onClick={openConfirm}
          >
            {label}
            <Text id={noteId} size="xs" c="dimmed" aria-hidden>
              {t("folderactions.detectfacesnote")}
            </Text>
          </Menu.Item>
        </DisabledReason>
      </HeaderActionsMenu>
      <ConfirmModal
        opened={confirmOpened}
        onClose={closeConfirm}
        onConfirm={() => {
          detectFaces.mutate({ path: folderPath });
          closeConfirm();
        }}
        title={t("folderactions.detectfacestitle", { folder: folderName })}
        message={t("folderactions.detectfacesmessage", { count: photoCount })}
        confirmLabel={t("folderactions.detectfacesconfirm")}
        confirmColor={theme.primaryColor}
      />
    </>
  );
}
