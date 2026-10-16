import type { PigPhoto } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPhoto, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAutoAlbumMutation, useSetEventCoverMutation } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { AutoAlbumDeleteModal } from "./AutoAlbumDeleteModal";

type Props = Readonly<{
  /** The event, with its title as the page shows it. */
  event: Readonly<{ id: string; title: string; coverPhoto: string | null }>;
  /** The event's photos, to pick the cover from. */
  photos: PigPhoto[];
}>;

/**
 * The event page's "⋮" (#429): Set as cover (any photo of the event, or back to the automatic
 * cover, its first photo) and Delete event, which goes back to Events.
 */
export function EventHeaderMenu({ event, photos }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [coverOpened, cover] = useDisclosure(false);
  const [deleteOpened, remove] = useDisclosure(false);
  const setCover = useSetEventCoverMutation();
  const deleteEvent = useDeleteAutoAlbumMutation();

  const closeAndFocus = (close: () => void) => () => {
    close();
    trigger.current?.focus();
  };

  return (
    <>
      <HeaderActionsMenu label={t("autoalbum.eventactions")} triggerRef={trigger}>
        <Menu.Item leftSection={<IconPhoto size={ICON_SIZE.menu} />} onClick={cover.open}>
          {t("modalalbumcover.menuitem")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={remove.open}>
          {t("autoalbum.delete")}
        </Menu.Item>
      </HeaderActionsMenu>
      <AlbumCoverPickerModal
        isOpen={coverOpened}
        onRequestClose={closeAndFocus(cover.close)}
        photos={photos}
        albumTitle={event.title}
        currentCoverId={event.coverPhoto}
        onSelectCover={photo => setCover.mutate({ id: event.id, photo })}
        onSelectAutomatic={() => setCover.mutate({ id: event.id, photo: null })}
      />
      <AutoAlbumDeleteModal
        opened={deleteOpened}
        onClose={closeAndFocus(remove.close)}
        title={event.title}
        onConfirm={() =>
          deleteEvent.mutate(
            { id: event.id, albumTitle: event.title },
            { onSuccess: () => void navigate({ to: "/album/events" }) }
          )
        }
      />
    </>
  );
}
