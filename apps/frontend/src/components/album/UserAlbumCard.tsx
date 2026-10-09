import { ActionIcon, Group, Menu, Popover, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
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
import type { UserAlbumInfo } from "../../api_client/albums/types";
import { Tile } from "../Tile";
import classes from "./UserAlbumCard.module.css";

type UserAlbumCardProps = {
  album: UserAlbumInfo;
  size?: number;
  showActions?: boolean;
  onRename?: (id: string, title: string) => void;
  onShare?: (id: string, title: string) => void;
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
        >
          <Users size={16} />
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
  size = 140,
  showActions = false,
  onRename,
  onShare,
  onDelete,
  onToggleLocked,
}: UserAlbumCardProps) {
  const { t } = useTranslation();

  return (
    <div className={classes.card} style={{ width: size }}>
      <Link to="/album/user/$id" params={{ id: album.id.toString() }} className={classes.coverLink}>
        <div className={classes.cover} style={{ width: size, height: size }}>
          {album.cover_photo ? (
            <Tile
              video={album.cover_photo.video === true}
              height={size}
              width={size}
              image_hash={album.cover_photo.image_hash}
              className={classes.coverImage}
            />
          ) : (
            <Text c="dimmed" size="xs">
              {t("explore.noCover")}
            </Text>
          )}
        </div>
      </Link>

      {/* Actions menu */}
      {showActions && (onRename || onShare || onDelete || onToggleLocked) && (
        <div className={classes.actions}>
          {/* Its items open dialogs: handing focus back to the trigger after close took it from
              the dialog's input. Escape still returns it (Mantine does that on its own). */}
          <Menu position="bottom-end" returnFocus={false} transitionProps={{ duration: 0 }}>
            <Menu.Target>
              {/* A solid chip, like the public badge opposite: a bare icon vanished on light covers */}
              <ActionIcon
                variant="default"
                radius="xl"
                size="sm"
                aria-label={t("useralbum.albumActions")}
                onClick={e => e.preventDefault()}
              >
                <DotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
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
            </Menu.Dropdown>
          </Menu>
        </div>
      )}

      {album.locked && (
        <div className={classes.lockedIcon}>
          <Tooltip label={t("useralbum.albumIsLocked")}>
            <span aria-label={t("useralbum.albumIsLocked")}>
              <Lock size={14} />
            </span>
          </Tooltip>
        </div>
      )}

      {/* Public indicator */}
      {album.public && (
        <div className={classes.publicIcon}>
          <Tooltip label={t("useralbum.albumIsPublic")}>
            <span>
              <LinkIcon size={14} />
            </span>
          </Tooltip>
        </div>
      )}

      {/* Album info */}
      <div className={classes.info}>
        <Group gap={4} wrap="nowrap">
          <SharedWith album={album} />
          <Text size="sm" fw={500} lineClamp={1} title={album.title}>
            {album.title}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
        </Text>
      </div>
    </div>
  );
}
