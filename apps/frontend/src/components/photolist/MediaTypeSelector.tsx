import type { MediaType } from "@librephotos/api-client";
import { ActionIcon, Button, Indicator, Menu, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPES } from "./mediaTypeFilter";
import { MEDIA_TYPE_OPTIONS } from "./mediaTypeOptions";
import { useMediaTypeFilter, useSetMediaTypeFilter } from "./useMediaTypeFilter";

// Screenshots and documents are categories rather than file kinds: a divider sets them apart.
// Mantine gives every item role="menuitem"; the button's name says which one is current.
const FIRST_CATEGORY: MediaType = "screenshots";

function MediaTypeMenuItem({ value, current }: Readonly<{ value: MediaType; current: MediaType }>) {
  const { t } = useTranslation();
  const select = useSetMediaTypeFilter();
  const { icon: Icon, color, labelKey } = MEDIA_TYPE_OPTIONS[value];
  const checked = value === current;
  return (
    <>
      {value === FIRST_CATEGORY && <Menu.Divider />}
      <Menu.Item
        leftSection={<Icon size={ICON_SIZE.inline} color={color} />}
        rightSection={checked ? <IconCheck size={ICON_SIZE.menu} /> : null}
        onClick={() => select(value)}
      >
        {t(labelKey)}
      </Menu.Item>
    </>
  );
}

// The per-view media filter (#2215, #2216): one menu button that names the
// current choice, like the timeline's Filter button beside it in the app. It
// reads and writes the current route's `?media` param, so a surface only
// renders it and reads useMediaTypeFilter() to feed its own data hook.
export function MediaTypeSelector() {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // On a phone the header has no room for a labelled button next to the title.
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const current = useMediaTypeFilter();
  const filtered = current !== DEFAULT_MEDIA_TYPE;
  const { icon: Icon, labelKey } = MEDIA_TYPE_OPTIONS[current];
  const variant = filtered ? "light" : "subtle";
  const color = filtered ? "blue" : "gray";

  return (
    <Menu position="bottom-end" shadow="md">
      {compact ? (
        // The dot goes on the Indicator, outside the target, so the ActionIcon
        // itself carries the menu's aria attributes.
        <Indicator size={8} disabled={!filtered}>
          <Menu.Target>
            <ActionIcon
              variant={variant}
              color={color}
              size="lg"
              aria-label={t("mediafilter.button", { current: t(labelKey) })}
            >
              <Icon size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Menu.Target>
        </Indicator>
      ) : (
        <Menu.Target>
          <Button
            variant={variant}
            color={color}
            h={TOOLBAR_CONTROL_HEIGHT}
            leftSection={<Icon size={18} />}
            rightSection={<IconChevronDown size={ICON_SIZE.menu} />}
            aria-label={t("mediafilter.button", { current: t(labelKey) })}
          >
            {t(labelKey)}
          </Button>
        </Menu.Target>
      )}
      <Menu.Dropdown aria-label={t("mediafilter.title")}>
        {MEDIA_TYPES.map(value => (
          <MediaTypeMenuItem key={value} value={value} current={current} />
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
