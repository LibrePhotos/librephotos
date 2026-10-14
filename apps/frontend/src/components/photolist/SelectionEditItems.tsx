import { Menu } from "@mantine/core";
import { IconCalendarTime as CalendarTime, IconMapPin as MapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  onSetLocation: () => void;
  onChangeDateTime: () => void;
}>;

/** The photo actions that open a dialog to edit the selection: its location (#2279) and its date (#2278). */
export function SelectionEditItems({ disabledReason, onSetLocation, onChangeDateTime }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<MapPin size={ICON_SIZE.menu} />} onClick={onSetLocation}>
          {t("selectionactions.setlocation")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<CalendarTime size={ICON_SIZE.menu} />} onClick={onChangeDateTime}>
          {t("selectionactions.changedatetime")}
        </Menu.Item>
      </DisabledReason>
    </>
  );
}
