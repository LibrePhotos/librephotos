import type { LibraryShare } from "@librephotos/api-client";
import { Badge, Menu, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDoorExit, IconLibraryPhoto, IconLock } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { EmptyState } from "../common/EmptyState";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { LeaveLibraryModal } from "./LeaveLibraryModal";
import { LibraryShareChips } from "./LibraryShareChips";
import { firstName, switchesOf } from "./libraryShareFields";
import { TimelineSwitch } from "./TimelineSwitch";

/** The library page's menu (#2731): leave the library, after a confirmation. */
export function LibraryMenu({ share }: Readonly<{ share: LibraryShare }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [leaveOpened, leaveDialog] = useDisclosure(false);
  const label = t("librarySharing.leaveLibrary", { name: firstName(share.owner) });
  return (
    <>
      <HeaderActionsMenu label={label}>
        <Menu.Item color="red" leftSection={<IconDoorExit size={ICON_SIZE.menu} />} onClick={leaveDialog.open}>
          {label}
        </Menu.Item>
      </HeaderActionsMenu>
      <LeaveLibraryModal
        opened={leaveOpened}
        onClose={leaveDialog.close}
        share={share}
        onLeft={() => void navigate({ to: "/sharing" })}
      />
    </>
  );
}

/** Under the library page's title: my timeline switch and what the owner shares. */
export function LibrarySubHeader({ share }: Readonly<{ share: LibraryShare }>) {
  return (
    <Stack gap={6} mt={4}>
      <TimelineSwitch share={share} withDescription />
      <LibraryShareChips switches={switchesOf(share)} />
    </Stack>
  );
}

/** Beside the library page's title. */
export function ReadOnlyBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color="gray" tt="none" leftSection={<IconLock size={12} aria-hidden />}>
      {t("librarySharing.readOnly")}
    </Badge>
  );
}

/** A library page whose library is not (or no longer) shared with me. */
export function LibraryNotShared() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<IconLibraryPhoto size={40} />}
      title={t("librarySharing.notSharedTitle")}
      description={t("librarySharing.notSharedDescription")}
      actionLabel={t("sidemenu.sharing")}
      actionLink="/sharing"
    />
  );
}
