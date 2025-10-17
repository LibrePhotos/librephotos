import { ActionIcon, Tooltip, useMantineColorScheme } from "@mantine/core";
import { IconMoon as Moon, IconSun as Sun } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

export function ColorModeSwitch(): React.ReactNode {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { t } = useTranslation();

  return (
    <Tooltip label={colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}>
      <ActionIcon
        onClick={() => toggleColorScheme()}
        variant="light"
        color="gray"
        size={30}
        aria-label="Toggle color scheme"
      >
        {colorScheme === "dark" ? <Moon size="1.1rem" /> : <Sun size="1.1rem" />}
      </ActionIcon>
    </Tooltip>
  );
}
