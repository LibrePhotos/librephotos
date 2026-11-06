import { Photoset } from "@librephotos/api-client";
import { Loader, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconTrashX } from "@tabler/icons-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useEmptyTrashMutation, useFollowEmptyTrashJob } from "../../api_client/photos/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { HeaderActionsMenu } from "./HeaderActionsMenu";

type Props = Readonly<{
  /** What the page shows: fewer than the trash holds while a media filter is on. */
  shownCount: number;
}>;

/** Every photo in the trash, whatever the page's media filter shows. */
function useWholeTrashCount(): number | undefined {
  const { data: groups } = useFetchDateAlbumsQuery({ photosetType: Photoset.IN_TRASHCAN, mediaType: "all" });
  return groups?.reduce((total, group) => total + group.numberOfItems, 0);
}

/**
 * The trash page's ⋯, with Empty trash (#2203) in it: after a confirmation naming the count and
 * the files on disk, a background job deletes every photo in the trash. The item waits for that
 * job, which says how it went. Named apart from the selection's Delete permanently, and out of the
 * header row, where a destructive button sat beside Select.
 */
export function TrashHeaderMenu({ shownCount }: Props) {
  const { t } = useTranslation();
  const [confirmOpen, { open, close }] = useDisclosure(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const total = useWholeTrashCount();
  const emptyTrash = useEmptyTrashMutation();
  const stopFollowing = useCallback(() => setJobId(null), []);
  useFollowEmptyTrashJob(jobId, stopFollowing);

  const running = jobId !== null || emptyTrash.isPending;
  const hidden = (total ?? 0) - shownCount;

  const confirm = () => {
    if (!total) return;
    emptyTrash.mutate(total, {
      onSuccess: id => {
        setJobId(id);
        close();
      },
    });
  };

  const item = running ? (
    <DisabledReason reason={t("trash.emptying")}>
      <Menu.Item leftSection={<Loader size={ICON_SIZE.menu} />}>{t("trash.emptying")}</Menu.Item>
    </DisabledReason>
  ) : (
    <Menu.Item color="red" leftSection={<IconTrashX size={ICON_SIZE.menu} />} onClick={open}>
      {t("trash.emptyTrash")}
    </Menu.Item>
  );

  return (
    <>
      <HeaderActionsMenu label={t("trash.actions")}>{total ? item : null}</HeaderActionsMenu>
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={confirm}
        loading={emptyTrash.isPending}
        title={t("trash.emptyConfirmTitle")}
        message={[
          t("trash.emptyConfirmMessage", { count: total ?? 0 }),
          hidden > 0 ? t("trash.emptyConfirmFiltered", { count: hidden }) : null,
          t("trash.emptyConfirmJob"),
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("trash.emptyTrash")}
        irreversible
      />
    </>
  );
}
