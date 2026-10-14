import { Photoset } from "@librephotos/api-client";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconTrashX } from "@tabler/icons-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useEmptyTrashMutation, useFollowEmptyTrashJob } from "../../api_client/photos/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";

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
 * The trash page's Empty trash (#2203): after a confirmation naming the count and the files on
 * disk, a background job deletes every photo in the trash. The button waits for that job, which
 * says how it went. Labelled, so it is not mistaken for the selection's Delete permanently; an
 * icon on a phone, where the label would push the title off.
 */
export function EmptyTrashButton({ shownCount }: Props) {
  const { t } = useTranslation();
  const [confirmOpen, { open, close }] = useDisclosure(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const total = useWholeTrashCount();
  const emptyTrash = useEmptyTrashMutation();
  const stopFollowing = useCallback(() => setJobId(null), []);
  useFollowEmptyTrashJob(jobId, stopFollowing);

  if (!total) return null;
  const running = jobId !== null || emptyTrash.isPending;
  const label = running ? t("trash.emptying") : t("trash.emptyTrash");
  const hidden = total - shownCount;

  const confirm = () =>
    emptyTrash.mutate(total, {
      onSuccess: id => {
        setJobId(id);
        close();
      },
    });

  return (
    <>
      <Button
        visibleFrom="sm"
        variant="light"
        color="red"
        leftSection={<IconTrashX size={18} />}
        loading={running}
        onClick={open}
      >
        {label}
      </Button>
      <Tooltip label={label} hiddenFrom="sm">
        <ActionIcon
          hiddenFrom="sm"
          variant="light"
          color="red"
          size="lg"
          aria-label={label}
          loading={running}
          onClick={open}
        >
          <IconTrashX size={20} />
        </ActionIcon>
      </Tooltip>
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
