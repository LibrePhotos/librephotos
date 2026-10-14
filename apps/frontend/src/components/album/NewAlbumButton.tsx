import type { AlbumCollection } from "@librephotos/api-client";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetUserAlbumCollectionsMutation } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { CreateUserAlbumModal } from "./UserAlbumModals";

type Props = Readonly<{
  /** The user's album titles, which a new album cannot take. */
  existingTitles: string[];
  /** The collection My Albums is showing (#1009): the new album goes into it. */
  collection?: AlbumCollection;
}>;

/**
 * My Albums' New album (#612): names an empty album and opens it, ready to upload into. A labelled
 * button on wide screens, a "+" on phones. Made while a collection is chosen, the album goes into
 * it, so it is not missing from the list the user came back to.
 */
export function NewAlbumButton({ existingTitles, collection }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setCollections = useSetUserAlbumCollectionsMutation();
  const [opened, { open, close }] = useDisclosure(false);
  const label = t("useralbum.newalbum");
  return (
    <>
      <Button visibleFrom="sm" variant="light" leftSection={<IconPlus size={ICON_SIZE.toolbar} />} onClick={open}>
        {label}
      </Button>
      <Tooltip label={label} hiddenFrom="sm">
        <ActionIcon hiddenFrom="sm" variant="light" size="lg" aria-label={label} onClick={open}>
          <IconPlus size={20} />
        </ActionIcon>
      </Tooltip>
      <CreateUserAlbumModal
        opened={opened}
        onClose={close}
        existingTitles={existingTitles}
        collectionName={collection?.name}
        onCreated={album => {
          const open = () => void navigate({ to: "/album/user/$id", params: { id: String(album.id) } });
          if (!collection) return open();
          // The album exists either way: a failed filing is toasted, and the album still opens
          setCollections.mutate({ albumId: album.id, collectionIds: [collection.id] }, { onSettled: open });
        }}
      />
    </>
  );
}
