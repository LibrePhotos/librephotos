import { Menu } from "@mantine/core";
import { IconCheck as Check, IconRestore as Restore } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { SortMenuTarget } from "../common/SortMenuTarget";
import { DIRECTION_LABELS, DIRECTIONS, sameSort, SORT_KEY_LABELS, sortForKey } from "./albumSort";
import type { AlbumSort } from "./albumSort";
import type { AlbumSortMenuState } from "./useAlbumSort";

/**
 * The sort button of an album list's header (#620): "Sort: Name" opening a menu with the keys,
 * the order and a way back to the page's default. Tinted, with a dot on phones, while the order
 * is not the default; its name always says the whole order, so the tint is not the only cue.
 */
export function AlbumSortMenu({ options, sort, defaultSort, onChange }: AlbumSortMenuState) {
  const { t } = useTranslation();
  const labelOf = (key: AlbumSort["key"]): ParseKeys =>
    options.find(option => option.key === key)?.label ?? SORT_KEY_LABELS[key];
  const keyLabel = t(labelOf(sort.key));
  const name = t("albumsort.current", { key: keyLabel, direction: t(DIRECTION_LABELS[sort.key][sort.direction]) });
  const isDefault = sameSort(sort, defaultSort);

  return (
    <Menu position="bottom-end" shadow="md">
      <SortMenuTarget name={name} label={t("albumsort.button", { key: keyLabel })} active={!isDefault} />
      <Menu.Dropdown>
        <AlbumSortMenuItems options={options} sort={sort} defaultSort={defaultSort} onChange={onChange} />
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The sort menu's items: the keys, the order and a way back to the page's default. Also the sort
 * section of a page's single overflow menu on a phone (PeopleHeader).
 */
export function AlbumSortMenuItems({ options, sort, defaultSort, onChange }: AlbumSortMenuState) {
  const { t } = useTranslation();
  const labelOf = (key: AlbumSort["key"]): ParseKeys =>
    options.find(option => option.key === key)?.label ?? SORT_KEY_LABELS[key];
  const isDefault = sameSort(sort, defaultSort);
  const check = <Check size={ICON_SIZE.inline} />;
  return (
    <>
      <Menu.Label>{t("albumsort.sortby")}</Menu.Label>
      {options.map(option => (
        <Menu.RadioItem
          key={option.key}
          value={option.key}
          checked={option.key === sort.key}
          onChange={() => onChange(sortForKey(option.key, sort, defaultSort))}
          checkIcon={check}
          closeMenuOnClick
        >
          {t(labelOf(option.key))}
        </Menu.RadioItem>
      ))}
      <Menu.Divider />
      <Menu.Label>{t("albumsort.order")}</Menu.Label>
      {DIRECTIONS[sort.key].map(direction => (
        <Menu.RadioItem
          key={direction}
          value={direction}
          checked={direction === sort.direction}
          onChange={() => onChange({ key: sort.key, direction })}
          checkIcon={check}
          closeMenuOnClick
        >
          {t(DIRECTION_LABELS[sort.key][direction])}
        </Menu.RadioItem>
      ))}
      {isDefault ? null : (
        <>
          <Menu.Divider />
          <Menu.Item leftSection={<Restore size={ICON_SIZE.menu} />} onClick={() => onChange(defaultSort)}>
            {t("albumsort.reset")}
          </Menu.Item>
        </>
      )}
    </>
  );
}
