import { ActionIcon, Button, Indicator, Menu, Tooltip, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArrowsSort as ArrowsSort, IconChevronDown as ChevronDown } from "@tabler/icons-react";
import React from "react";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "./toolbarLook";

type Props = Readonly<{
  name: string;
  label: string;
  active: boolean;
}>;

export function SortMenuTarget({ name, label, active }: Props) {
  const theme = useMantineTheme();
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const look = toolbarLook(active);

  return (
    <Menu.Target>
      {isPhone ? (
        <Indicator size={8} offset={4} disabled={!active}>
          <Tooltip label={name} position="bottom">
            <ActionIcon {...look} size={TOOLBAR_ACTION_SIZE} aria-label={name}>
              <ArrowsSort size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Tooltip>
        </Indicator>
      ) : (
        <Button
          {...look}
          h={TOOLBAR_CONTROL_HEIGHT}
          leftSection={<ArrowsSort size={ICON_SIZE.toolbar} />}
          rightSection={<ChevronDown size={ICON_SIZE.inline} />}
          aria-label={name}
          title={name}
        >
          {label}
        </Button>
      )}
    </Menu.Target>
  );
}
