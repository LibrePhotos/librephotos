import { ActionIcon, Button, Indicator, Menu, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowsSort as ArrowsSort,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconRestore as Restore,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
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
  const theme = useMantineTheme();
  // Read at once rather than after mounting, so a phone never shows the wide button first
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const labelOf = (key: AlbumSort["key"]): ParseKeys =>
    options.find(option => option.key === key)?.label ?? SORT_KEY_LABELS[key];
  const keyLabel = t(labelOf(sort.key));
  const name = t("albumsort.current", { key: keyLabel, direction: t(DIRECTION_LABELS[sort.key][sort.direction]) });
  const isDefault = sameSort(sort, defaultSort);
  const variant = isDefault ? "default" : "light";
  const check = <Check size={ICON_SIZE.menu} />;

  return (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        {isPhone ? (
          <Indicator size={8} offset={4} disabled={isDefault}>
            <ActionIcon variant={variant} size="lg" aria-label={name} title={name}>
              <ArrowsSort size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Indicator>
        ) : (
          <Button
            variant={variant}
            leftSection={<ArrowsSort size={ICON_SIZE.toolbar} />}
            rightSection={<ChevronDown size={ICON_SIZE.inline} />}
            aria-label={name}
            title={name}
          >
            {t("albumsort.button", { key: keyLabel })}
          </Button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
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
      </Menu.Dropdown>
    </Menu>
  );
}
