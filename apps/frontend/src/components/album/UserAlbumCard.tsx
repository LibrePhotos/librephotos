import type { UserAlbumInfo } from "@librephotos/api-client";
import { Group, Menu, Popover, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconEdit as Edit,
  IconFolders as Folders,
  IconPhoto,
  IconLink as LinkIcon,
  IconLock as Lock,
  IconLockOpen as LockOpen,
  IconShare as Share,
  IconTrash as Trash,
  IconUser as User,
  IconUsers as Users,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../common/CollectionCard";
import classes from "./UserAlbumCard.module.css";

type UserAlbumCardProps = {
  album: UserAlbumInfo;
  size?: number;
  /** Sizes the card in a scrolling row; in a grid cell it fills the cell. */
  className?: string;
  showActions?: boolean;
  onRename?: (id: string, title: string) => void;
  onShare?: (id: string, title: string) => void;
  /** Opens the album's Collections dialog (#1009). */
  onCollections?: (id: string, title: string) => void;
  onDelete?: (id: string, title: string) => void;
  onToggleLocked?: (id: string, locked: boolean) => void;
};

function SharedWith({ album }: Readonly<{ album: UserAlbumInfo }>) {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure(false);

  if (album.shared_to.length === 0) return null;

  return (
    <Popover opened={opened} position="bottom" width={260} onClose={close}>
      <Popover.Target>
        <span
          className={classes.sharedIcon}
          onClick={e => {
            e.preventDefault();
            toggle();
          }}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={t("useralbum.sharedWith")}
        >
          <Users size={16} stroke={2} />
        </span>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Title order={6}>{t("useralbum.sharedWith")}</Title>
          {album.shared_to.map(el => (
            <Group key={el.username} gap="xs">
              <User size={14} />
              <Text size="sm" fw={500}>
                {el.username}
              </Text>
            </Group>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function UserAlbumCard({
  album,
  size = 180,
  className,
  showActions = false,
  onRename,
  onShare,
  onCollections,
  onDelete,
  onToggleLocked,
}: UserAlbumCardProps) {
  const { t } = useTranslation();
  const hasActions = showActions && (onRename || onShare || onCollections || onDelete || onToggleLocked);
  const hasBadges = album.locked || album.public || album.shared_to.length > 0;

  return (
    <CollectionCard
      className={className}
      size={size}
      title={album.title}
      meta={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
      covers={album.cover_photo ? [album.cover_photo] : []}
      placeholder={<IconPhoto />}
      renderLink={props => <Link {...props} to="/album/user/$id" params={{ id: album.id.toString() }} />}
      badges={
        hasBadges ? (
          <>
            <SharedWith album={album} />
            {album.locked && (
              <Tooltip label={t("useralbum.albumIsLocked")}>
                <span role="img" aria-label={t("useralbum.albumIsLocked")}>
                  <Lock size={16} />
                </span>
              </Tooltip>
            )}
            {album.public && (
              <Tooltip label={t("useralbum.albumIsPublic")}>
                <span role="img" aria-label={t("useralbum.albumIsPublic")}>
                  <LinkIcon size={16} />
                </span>
              </Tooltip>
            )}
          </>
        ) : null
      }
      menuLabel={t("useralbum.albumActions")}
      menuItems={
        hasActions ? (
          <>
            {onRename && (
              <Menu.Item leftSection={<Edit size={14} />} onClick={() => onRename(`${album.id}`, album.title)}>
                {t("rename")}
              </Menu.Item>
            )}
            {onShare && (
              <Menu.Item leftSection={<Share size={14} />} onClick={() => onShare(`${album.id}`, album.title)}>
                {t("sidemenu.sharing")}
              </Menu.Item>
            )}
            {onCollections && (
              <Menu.Item leftSection={<Folders size={14} />} onClick={() => onCollections(`${album.id}`, album.title)}>
                {t("albumcollections.menuitem")}
              </Menu.Item>
            )}
            {onToggleLocked && (
              <Menu.Item
                leftSection={album.locked ? <LockOpen size={14} /> : <Lock size={14} />}
                onClick={() => onToggleLocked(`${album.id}`, !album.locked)}
              >
                {t(album.locked ? "useralbum.unlockAlbum" : "useralbum.lockAlbum")}
              </Menu.Item>
            )}
            {onDelete && (
              <Menu.Item leftSection={<Trash size={14} />} onClick={() => onDelete(`${album.id}`, album.title)}>
                {t("delete")}
              </Menu.Item>
            )}
          </>
        ) : null
      }
    />
  );
}
