import { ActionIcon, Button, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconMapPinPlus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why a place cannot be added now (no map, or one is being edited), if it cannot. */
  blocked: string | null;
  onAdd: () => void;
}>;

/**
 * Places' one create action, Add place (#1365): tonal, in the header's fixed slot after the sort,
 * like My Albums' New album. An icon with its name as a tooltip on a phone.
 */
export function AddPlaceButton({ blocked, onAdd }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // Read at once rather than after mounting, so a phone never shows the wide button first
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const label = t("yourplaces.add");
  return isPhone ? (
    <DisabledReason reason={blocked} label={label}>
      <ActionIcon variant="light" size={TOOLBAR_ACTION_SIZE} aria-label={label} onClick={onAdd}>
        <IconMapPinPlus size={ICON_SIZE.toolbar} />
      </ActionIcon>
    </DisabledReason>
  ) : (
    <DisabledReason reason={blocked}>
      <Button
        variant="light"
        h={TOOLBAR_CONTROL_HEIGHT}
        leftSection={<IconMapPinPlus size={ICON_SIZE.toolbar} />}
        onClick={onAdd}
      >
        {label}
      </Button>
    </DisabledReason>
  );
}
