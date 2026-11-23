import type { SearchSort } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { IconCheck as Check, IconRestore as Restore } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { SortMenuTarget } from "../common/SortMenuTarget";
import { PHOTO_SORT_LABELS, PHOTO_SORTS } from "./photoSort";

type Props = Readonly<{
  sort: SearchSort;
  onChange: (sort: SearchSort) => void;
  onReset?: () => void;
}>;

export function PhotoSortMenu({ sort, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const name = t("albumsort.button", { key: t(PHOTO_SORT_LABELS[sort]) });
  const check = <Check size={ICON_SIZE.inline} />;

  return (
    <Menu position="bottom-end" shadow="md">
      <SortMenuTarget name={name} label={name} active={onReset !== undefined} />
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
