import { Menu } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconChevronLeft } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { SHEET_QUERY } from "../../theme/menuTheme";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "./DisabledReason";

type Props = Readonly<{
  label: string;
  icon: React.ReactNode;
  /** Why the submenu is off (nothing selected), or false while it works: then it does not open. */
  reason?: string | false;
  /** The submenu's `Menu.Item`s. */
  children: React.ReactNode;
}>;

/**
 * A menu item that opens a submenu ("Edit info ▸"): on hover and arrow right, as Mantine's do, and
 * on a click or tap too, since a phone has no hover. On a phone the submenu is a second action sheet
 * over the first (menuTheme.ts), headed by a Back row that closes it again.
 */
export function MenuSubmenu({ label, icon, reason, children }: Props) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const isPhone = useMediaQuery(SHEET_QUERY);
  if (reason) {
    return (
      <DisabledReason reason={reason} position="left">
        <Menu.Item leftSection={icon}>{label}</Menu.Item>
      </DisabledReason>
    );
  }
  return (
    <Menu.Sub opened={opened} onChange={isOpen => (isOpen ? open() : close())}>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={icon} onClick={open}>
          {label}
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        {isPhone && (
          <Menu.Item
            leftSection={<IconChevronLeft size={ICON_SIZE.menu} />}
            closeMenuOnClick={false}
            aria-label={t("back")}
            onClick={close}
          >
            {label}
          </Menu.Item>
        )}
        {children}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}
