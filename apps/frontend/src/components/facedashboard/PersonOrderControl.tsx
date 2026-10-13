import { Center, SegmentedControl, Tooltip, VisuallyHidden } from "@mantine/core";
import {
  IconSortAscendingLetters as SortAscendingLetters,
  IconSortDescendingNumbers as SortDescendingNumbers,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { FacesPersonOrder } from "./facesTab";

type Props = Readonly<{
  value: FacesPersonOrder;
  onChange: (order: FacesPersonOrder | undefined) => void;
}>;

/**
 * The order of the people on the dashboard (#764), next to the order of their faces. Icons with a
 * tooltip and a hidden label, not words: the toolbar must still fit one line at 1280 px with the
 * Inferred tab's filters.
 */
export function PersonOrderControl({ value, onChange }: Props) {
  const { t } = useTranslation();
  const option = (order: FacesPersonOrder, label: string, icon: React.ReactNode) => ({
    value: order,
    label: (
      <Tooltip label={label}>
        <Center>
          {icon}
          <VisuallyHidden>{label}</VisuallyHidden>
        </Center>
      </Tooltip>
    ),
  });

  return (
    <SegmentedControl
      aria-label={t("facesdashboard.personorder")}
      value={value}
      onChange={next => onChange(FacesPersonOrder.safeParse(next).data)}
      data={[
        option(
          FacesPersonOrder.enum.name,
          t("facesdashboard.personorderbyname"),
          <SortAscendingLetters size={ICON_SIZE.inline} />
        ),
        option(
          FacesPersonOrder.enum.count,
          t("facesdashboard.personorderbycount"),
          <SortDescendingNumbers size={ICON_SIZE.inline} />
        ),
      ]}
    />
  );
}
