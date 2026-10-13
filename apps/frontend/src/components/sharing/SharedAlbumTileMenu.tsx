import { ActionIcon, Menu } from "@mantine/core";
import { IconDoorExit, IconDotsVertical } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import classes from "./AlbumsShared.module.css";

type Props = Readonly<{
  /** Names the chip for screen readers, since every tile has one. */
  title: string;
  onLeave: () => void;
}>;

/**
 * The "⋮" chip on an album tile under "Shared with me" (#2210), the same chip as on My Albums'
 * cards, with the one thing a recipient can do: Leave album, which asks first.
 */
export function SharedAlbumTileMenu({ title, onLeave }: Props) {
  const { t } = useTranslation();
  return (
    <div className={classes.tileActions}>
      {/* The item opens a dialog: handing focus back to the chip would take it from the dialog. */}
      <Menu position="bottom-end" returnFocus={false} transitionProps={{ duration: 0 }}>
        <Menu.Target>
          {/* A solid chip: a bare icon vanishes on a light cover */}
          <ActionIcon variant="default" radius="xl" size="sm" aria-label={`${t("useralbum.albumActions")}: ${title}`}>
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item color="red" leftSection={<IconDoorExit size={ICON_SIZE.menu} />} onClick={onLeave}>
            {t("useralbum.leavealbum")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
