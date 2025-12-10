import { ActionIcon, Group, Menu, Popover, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconLink as LinkIcon,
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
};

function SharedWith({ album }: Readonly<{ album: UserAlbumInfo }>) {
  const [opened, { toggle, close }] = useDisclosure(false);

  if (album.shared_to.length === 0) return null;

  return (
    <Popover opened={opened} position="bottom" width={260} onClose={close}>
      <Popover.Target>
        <span className={classes.sharedIcon} onClick={(e) => { e.preventDefault(); toggle(); }}>
          <Users size={16} />
        </span>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Title order={6}>Shared with:</Title>
          {album.shared_to.map(el => (
            <Group key={el.username} gap="xs">
              <User size={14} />
              <Text size="sm" fw={500}>{el.username}</Text>
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
            <Text c="dimmed" size="xs">{t("explore.noCover")}</Text>
          )}
        </div>
      </Link>

      {/* Actions menu */}
      {showActions && (onRename || onShare || onDelete) && (
        <div className={classes.actions}>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" c="gray" size="sm" onClick={(e) => e.preventDefault()}>
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
              {onDelete && (
                <Menu.Item leftSection={<Trash size={14} />} onClick={() => onDelete(`${album.id}`, album.title)}>
                  {t("delete")}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </div>
      )}

      {/* Public indicator */}
      {album.public && (
        <div className={classes.publicIcon}>
          <Tooltip label="This album is public">
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
          {t("numberofphotos", { number: album.photo_count })}
        </Text>
      </div>
    </div>
  );
}





