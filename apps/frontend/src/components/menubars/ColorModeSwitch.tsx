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
        variant="subtle"
        color="gray"
        size={36}
        radius="xl"
        // The action, not just the noun: the state is only in the tooltip.
        aria-label={t("settings.togglecolorscheme")}
      >
        {colorScheme === "dark" ? <Moon size={20} stroke={1.75} /> : <Sun size={20} stroke={1.75} />}
      </ActionIcon>
    </Tooltip>
  );
}
