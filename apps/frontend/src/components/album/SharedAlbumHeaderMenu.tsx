import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDoorExit } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { LeaveSharedAlbumModal, type LeavableAlbum } from "./LeaveSharedAlbumModal";

type Props = Readonly<{ album: LeavableAlbum }>;

/**
 * The "⋮" on an album someone shared with you (#2210): Leave album, after a confirmation, then
 * back to "Shared with me". Door, not logout: that icon means signing out in the account menu.
 */
export function SharedAlbumHeaderMenu({ album }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [leaveOpened, leave] = useDisclosure(false);

  return (
    <>
      <HeaderActionsMenu label={t("useralbum.albumActions")} triggerRef={trigger}>
        <Menu.Item color="red" leftSection={<IconDoorExit size={ICON_SIZE.menu} />} onClick={leave.open}>
          {t("useralbum.leavealbum")}
        </Menu.Item>
      </HeaderActionsMenu>
      <LeaveSharedAlbumModal
        opened={leaveOpened}
        onClose={() => {
          leave.close();
          trigger.current?.focus();
        }}
        album={album}
        onLeft={() => void navigate({ to: "/sharing/withme/$tab", params: { tab: "albums" } })}
      />
    </>
  );
}
