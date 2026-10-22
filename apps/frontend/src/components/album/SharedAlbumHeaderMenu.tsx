import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDoorExit, IconEyeCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { LeaveSharedAlbumModal, type LeavableAlbum } from "./LeaveSharedAlbumModal";
import { MySwitchesModal } from "./MySwitchesModal";

type Props = Readonly<{ album: LeavableAlbum }>;

/**
 * The "⋮" on an album someone shared with you (#2210): Leave album, after a confirmation, then
 * back to "Shared with me". Door, not logout: that icon means signing out in the account menu. A
 * contributor (#464) also sets what the others see of the photos they add.
 */
export function SharedAlbumHeaderMenu({ album }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [leaveOpened, leave] = useDisclosure(false);
  const [switchesOpened, switches] = useDisclosure(false);
  const restoreFocus = () => trigger.current?.focus();

  return (
    <>
      <HeaderActionsMenu label={t("useralbum.albumActions")} triggerRef={trigger}>
        {album.my_role === "contributor" && (
          <Menu.Item leftSection={<IconEyeCheck size={ICON_SIZE.menu} />} onClick={switches.open}>
            {t("collab.mySwitches")}
          </Menu.Item>
        )}
        <Menu.Item color="red" leftSection={<IconDoorExit size={ICON_SIZE.menu} />} onClick={leave.open}>
          {t("useralbum.leavealbum")}
        </Menu.Item>
      </HeaderActionsMenu>
      <LeaveSharedAlbumModal
        opened={leaveOpened}
        onClose={() => {
          leave.close();
          restoreFocus();
        }}
        album={album}
        onLeft={() => void navigate({ to: "/sharing/withme/$tab", params: { tab: "albums" } })}
      />
      {album.my_role === "contributor" && (
        <MySwitchesModal
          opened={switchesOpened}
          onClose={() => {
            switches.close();
            restoreFocus();
          }}
          album={album}
        />
      )}
    </>
  );
}
