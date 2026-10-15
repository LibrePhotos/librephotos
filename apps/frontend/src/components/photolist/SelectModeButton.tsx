import { ActionIcon, Button, Tooltip, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCheckbox } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";

type Props = Readonly<{
  selecting: boolean;
  onToggle: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}>;

/**
 * "Select" in a photo list's header toolbar (#2240): turns select mode on, which brings up the
 * selection bar, and off again. A labelled button, an icon on phones, like the Filters button.
 */
export function SelectModeButton({ selecting, onToggle, ref }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const label = t("selectionbar.selectmode");
  const look = selecting
    ? ({ variant: "light", color: "blue" } as const)
    : ({ variant: "subtle", color: "gray" } as const);

  return (
    <Tooltip label={t("selectionbar.selectphotos")} position="bottom">
      {compact ? (
        <ActionIcon
          {...look}
          ref={ref}
          size={TOOLBAR_ACTION_SIZE}
          aria-label={label}
          aria-pressed={selecting}
          onClick={onToggle}
        >
          <IconCheckbox size={ICON_SIZE.toolbar} />
        </ActionIcon>
      ) : (
        <Button
          {...look}
          ref={ref}
          h={TOOLBAR_CONTROL_HEIGHT}
          leftSection={<IconCheckbox size={ICON_SIZE.toolbar} />}
          aria-pressed={selecting}
          onClick={onToggle}
        >
          {label}
        </Button>
      )}
    </Tooltip>
  );
}
