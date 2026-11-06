import type { UserAlbum } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink, IconPlus, IconShare } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import type { AlbumUpload } from "../upload/useAlbumUpload";
import { AlbumMembers } from "./AlbumMembers";
import classes from "./UserAlbumIdentity.module.css";

type Props = Readonly<{
  album: Pick<UserAlbum, "id" | "owner" | "shared_to" | "my_role" | "public">;
  /** Whether the viewer owns the album: the owner shares it and adds to it here. */
  own: boolean;
  /** Upload into the album (#612); absent when the viewer cannot. */
  upload?: AlbumUpload | null;
}>;

/**
 * A user album's people and its two main actions under its title, as Immich heads an album: the
 * members' faces, then Share (tonal; a link icon once the album has a public link) and Add photos
 * (subtle, the album upload). A recipient sees whose album it is.
 */
export function UserAlbumIdentity({ album, own, upload }: Props) {
  const { t } = useTranslation();
  const [shareOpened, share] = useDisclosure(false);
  const sharedTo = album.shared_to ?? [];
  const members =
    !own || sharedTo.length > 0 ? (
      <AlbumMembers owner={album.owner} sharedTo={sharedTo} own={own} contributor={album.my_role === "contributor"} />
    ) : null;
  if (!own) return members ? <div className={classes.row}>{members}</div> : null;

  return (
    <div className={classes.row}>
      {members}
      <div className={classes.actions}>
        <Button
          variant="light"
          radius="xl"
          size="compact-md"
          leftSection={album.public ? <IconLink size={16} /> : <IconShare size={16} />}
          onClick={share.open}
        >
          {t("useralbum.share")}
        </Button>
        {upload ? (
          <DisabledReason reason={upload.reason}>
            <Button
              variant="subtle"
              radius="xl"
              size="compact-md"
              leftSection={<IconPlus size={16} />}
              onClick={upload.open}
            >
              {t("useralbum.addphotos")}
            </Button>
          </DisabledReason>
        ) : null}
      </div>
      <ModalAlbumShare
        isOpen={shareOpened}
        onRequestClose={share.close}
        albumID={String(album.id)}
        ownerUsername={album.owner.username}
      />
    </div>
  );
}
