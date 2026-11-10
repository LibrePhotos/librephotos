import { Photoset } from "@librephotos/api-client";
import { ActionIcon, Button, Loader, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconTrashX } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useEmptyTrashMutation, useFollowEmptyTrashJob } from "../../api_client/photos/hooks";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{
  /** Every photo and video in the trash, whatever the media filter shows; undefined while it loads. */
  total: number | undefined;
  /** What the page shows: fewer than the trash holds while a media filter is on. */
  shownCount: number;
}>;

/**
 * "Empty trash" in the trash page's header, left of Select, as Google Photos and Immich show it: a
 * subtle red button (an icon on a phone) while the trash holds anything. After a confirmation naming
 * the count and the files on disk, a background job deletes every photo in the trash; the button
 * waits for that job, which says how it went.
 */
export function EmptyTrashButton({ total, shownCount }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [confirmOpen, { open, close }] = useDisclosure(false);
  const emptyTrash = useEmptyTrashMutation();
  const jobId = useFollowEmptyTrashJob();

  if (!total) {
    return null;
  }
  const running = jobId !== null || emptyTrash.isPending;
  const hidden = total - shownCount;
  const label = running ? t("trash.emptying") : t("trash.emptyTrash");
  const icon = running ? <Loader size={ICON_SIZE.toolbar} color="red" /> : <IconTrashX size={ICON_SIZE.toolbar} />;

  const confirm = () => {
    emptyTrash.mutate(total, { onSuccess: close });
  };

  const button = compact ? (
    <ActionIcon variant="subtle" color="red" size={TOOLBAR_ACTION_SIZE} aria-label={label} onClick={open}>
      {icon}
    </ActionIcon>
  ) : (
    <Button variant="subtle" color="red" h={TOOLBAR_CONTROL_HEIGHT} leftSection={icon} onClick={open}>
      {label}
    </Button>
  );

  return (
    <>
      {/* On a phone the icon's name shows on hover; while the job runs, why it cannot be pressed. */}
      <DisabledReason reason={running && t("trash.emptying")} label={compact ? label : undefined} position="bottom">
        {button}
      </DisabledReason>
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={confirm}
        loading={emptyTrash.isPending}
        title={t("trash.emptyConfirmTitle")}
        message={[
          t("trash.emptyConfirmMessage", { count: total }),
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

/** How many photos and how many videos the whole trash holds, whatever the page's media filter shows. */
export function useTrashCounts(): { total: number | undefined; videos: number | undefined } {
  const sum = (groups: { numberOfItems: number }[] | undefined) =>
    groups?.reduce((count, group) => count + group.numberOfItems, 0);
  const all = useFetchDateAlbumsQuery({ photosetType: Photoset.IN_TRASHCAN, mediaType: "all" });
  const videos = useFetchDateAlbumsQuery({ photosetType: Photoset.IN_TRASHCAN, mediaType: "videos" });
  return { total: sum(all.data), videos: sum(videos.data) };
}
