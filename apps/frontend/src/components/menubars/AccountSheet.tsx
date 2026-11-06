import type { ImportJob, User } from "@librephotos/api-client";
import type { MantineColorScheme } from "@mantine/core";
import {
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import type { Icon } from "@tabler/icons-react";
import {
  IconAdjustments,
  IconBook,
  IconListDetails,
  IconLogout,
  IconSettings,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { UserAvatar, userDisplayName } from "../common/UserAvatar";
import classes from "./AccountSheet.module.css";
import { ImportJobMenuSection } from "./ImportJobMenuSection";
import { TRASH_LINK } from "./navigation";

const SCHEMES = ["light", "dark", "auto"] as const satisfies readonly MantineColorScheme[];
const isScheme = (value: string): value is MantineColorScheme => SCHEMES.some(scheme => scheme === value);

type Row = Readonly<{ icon: Icon; label: string; onClick: () => void }>;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  user: User | undefined;
  imports: ImportJob[];
  onLogout: () => void;
}>;

/**
 * The phone's account menu as a bottom sheet over a dimmed page, as Google Photos opens it: who is
 * signed in, the colour scheme as Light / Dark / Auto, then the account pages in finger-sized rows.
 */
export function AccountSheet({ opened, onClose, user, imports, onLogout }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const go = (to: string) => () => {
    onClose();
    void navigate({ to });
  };
  const rows: Row[] = [
    { icon: IconBook, label: t("topmenu.library"), onClick: go("/library") },
    { icon: IconUser, label: t("topmenu.profile"), onClick: go("/profile") },
    { icon: IconSettings, label: t("topmenu.settings"), onClick: go("/settings") },
    { icon: IconListDetails, label: t("topmenu.jobs"), onClick: go("/jobs") },
    { icon: IconTrash, label: t("photos.deleted"), onClick: go(TRASH_LINK) },
    ...(user?.is_superuser ? [{ icon: IconAdjustments, label: t("topmenu.adminarea"), onClick: go("/admin") }] : []),
  ];

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.4 }}
      classNames={{ content: classes.sheet, body: classes.body }}
      aria-label={t("topmenu.accountmenu")}
    >
      <div className={classes.handle} aria-hidden />
      {user && (
        <Group gap="sm" wrap="nowrap" px="md" pb="sm">
          <UserAvatar user={user} size={40} />
          <Stack gap={0} miw={0}>
            <Text fw={600} truncate>
              {userDisplayName(user)}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {user.username}
            </Text>
          </Stack>
        </Group>
      )}
      {imports.length > 0 && <ImportJobMenuSection imports={imports} divider={false} />}
      <SegmentedControl
        fullWidth
        mx="md"
        mb="sm"
        aria-label={t("settings.colorscheme.title")}
        value={colorScheme}
        onChange={value => isScheme(value) && setColorScheme(value)}
        data={[
          { value: "light", label: t("settings.colorscheme.light") },
          { value: "dark", label: t("settings.colorscheme.dark") },
          { value: "auto", label: t("settings.colorscheme.auto") },
        ]}
      />
      <Divider />
      <div role="menu" aria-label={t("topmenu.accountmenu")} className={classes.rows}>
        {rows.map(row => (
          <UnstyledButton key={row.label} role="menuitem" className={classes.row} onClick={row.onClick}>
            <row.icon size={20} stroke={1.75} aria-hidden />
            {row.label}
          </UnstyledButton>
        ))}
        <Divider my={4} />
        <UnstyledButton
          role="menuitem"
          className={classes.row}
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          <IconLogout size={20} stroke={1.75} aria-hidden />
          {t("topmenu.logout")}
        </UnstyledButton>
      </div>
    </Drawer>
  );
}
