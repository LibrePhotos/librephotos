import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon as Moon, IconSun as Sun } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

export function ColorModeSwitch(): React.ReactNode {
  const { toggleColorScheme } = useMantineColorScheme();
  // The raw scheme is "auto" until the user picks one; show the one in effect.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const { t } = useTranslation();

  return (
    <Tooltip label={colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}>
      <ActionIcon
        onClick={() => toggleColorScheme()}
        variant="light"
        color="gray"
        size={30}
        // The action, not just the noun: the state is only in the tooltip.
        aria-label={t("settings.togglecolorscheme")}
      >
        {colorScheme === "dark" ? <Moon size="1.1rem" /> : <Sun size="1.1rem" />}
      </ActionIcon>
    </Tooltip>
  );
}
