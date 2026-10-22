import { Menu } from "@mantine/core";
import { IconKeyboard as Keyboard } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { HelpKeyHint } from "./ShortcutHint";
import { useOpenShortcuts } from "./shortcutsOverlay";

/**
 * Keyboard shortcuts in the account menu (#2037), after a divider. Nothing outside the signed-in
 * app (the public pages share the menu), where there are no shortcuts to list.
 */
export function ShortcutsMenuItem() {
  const { t } = useTranslation();
  const openShortcuts = useOpenShortcuts();
  if (!openShortcuts) {
    return null;
  }
  return (
    <>
      <Menu.Divider />
      <Menu.Item leftSection={<Keyboard size={14} />} rightSection={<HelpKeyHint />} onClick={openShortcuts}>
        {t("topmenu.shortcuts")}
      </Menu.Item>
    </>
  );
}
