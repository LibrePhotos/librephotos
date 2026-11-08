import { FaceOrderBy } from "@librephotos/api-client";
import { ActionIcon, Button, Indicator, Menu } from "@mantine/core";
import { IconArrowsSort as ArrowsSort, IconChevronDown as ChevronDown } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { FACES_SEARCH_DEFAULTS, FacesPersonOrder, type FacesRouteOrder } from "./facesTab";

type Props = Readonly<{
  orderBy: FacesRouteOrder;
  personOrder: FacesPersonOrder;
  onOrderBy: (order: FaceOrderBy) => void;
  onPersonOrder: (order: FacesPersonOrder) => void;
  /** A phone: an icon with a dot while the order is not the default. */
  compact: boolean;
}>;

/**
 * The faces dashboard's Sort menu: the order of the faces (confidence or date) and of the people
 * (#764, #622: similar faces together), in one menu instead of two controls in the toolbar. The
 * chosen orders carry the theme's trailing check (menuTheme.ts).
 */
export function FacesSortMenu({ orderBy, personOrder, onOrderBy, onPersonOrder, compact }: Props) {
  const { t } = useTranslation();
  const isDefault = orderBy === FACES_SEARCH_DEFAULTS.orderBy && personOrder === FACES_SEARCH_DEFAULTS.personOrder;
  const look = toolbarLook(!isDefault);
  const label = t("facesdashboard.sort");
  const faceOrders = [
    { value: FaceOrderBy.enum.confidence, label: t("facesdashboard.sortbyconfidence") },
    { value: FaceOrderBy.enum.date, label: t("facesdashboard.sortbydate") },
  ];
  const personOrders = [
    { value: FacesPersonOrder.enum.name, label: t("facesdashboard.personorderbyname") },
    { value: FacesPersonOrder.enum.count, label: t("facesdashboard.personorderbycount") },
    { value: FacesPersonOrder.enum.similar, label: t("facesdashboard.personorderbysimilarity") },
  ];

  return (
    <Menu position="bottom-end">
      <Menu.Target>
        {compact ? (
          <Indicator size={8} offset={4} disabled={isDefault}>
            <ActionIcon {...look} size={TOOLBAR_ACTION_SIZE} aria-label={label} title={label}>
              <ArrowsSort size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Indicator>
        ) : (
          <Button
            {...look}
            h={TOOLBAR_CONTROL_HEIGHT}
            leftSection={<ArrowsSort size={ICON_SIZE.toolbar} />}
            rightSection={<ChevronDown size={ICON_SIZE.inline} />}
          >
            {label}
          </Button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("facesdashboard.sortby")}</Menu.Label>
        {faceOrders.map(option => (
          <Menu.RadioItem
            key={option.value}
            value={option.value}
            // "person", an older order, sorts by date
            checked={option.value === (orderBy === "person" ? FaceOrderBy.enum.date : orderBy)}
            onChange={() => onOrderBy(option.value)}
            closeMenuOnClick
          >
            {option.label}
          </Menu.RadioItem>
        ))}
        <Menu.Divider />
        <Menu.Label>{t("facesdashboard.personorder")}</Menu.Label>
        {personOrders.map(option => (
          <Menu.RadioItem
            key={option.value}
            value={option.value}
            checked={option.value === personOrder}
            onChange={() => onPersonOrder(option.value)}
            closeMenuOnClick
          >
            {option.label}
          </Menu.RadioItem>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
