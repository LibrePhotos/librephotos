import type { SearchSort } from "@librephotos/api-client";
import { ActionIcon, Button, Indicator, Menu, Tooltip, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowsSort as ArrowsSort,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconRestore as Restore,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { PHOTO_SORT_LABELS, PHOTO_SORTS } from "./photoSort";

type Props = Readonly<{
  sort: SearchSort;
  onChange: (sort: SearchSort) => void;
  onReset?: () => void;
}>;

export function PhotoSortMenu({ sort, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const label = t(PHOTO_SORT_LABELS[sort]);
  const name = t("albumsort.button", { key: label });
  const look = toolbarLook(onReset !== undefined);
  const check = <Check size={ICON_SIZE.inline} />;

  return (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        {isPhone ? (
          <Indicator size={8} offset={4} disabled={onReset === undefined}>
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
            {name}
          </Button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("albumsort.sortby")}</Menu.Label>
        {PHOTO_SORTS.map(value => (
          <Menu.RadioItem
            key={value}
            value={value}
            checked={value === sort}
            onChange={() => onChange(value)}
            checkIcon={check}
            closeMenuOnClick
          >
            {t(PHOTO_SORT_LABELS[value])}
          </Menu.RadioItem>
        ))}
        {onReset === undefined ? null : (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<Restore size={ICON_SIZE.menu} />} onClick={onReset}>
              {t("albumsort.reset")}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
