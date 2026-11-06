import type { SearchFilters } from "@librephotos/api-client";
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery, useUncontrolled } from "@mantine/hooks";
import { IconFilter } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/hooks";
import { ICON_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { countSearchFilters } from "./searchFilter";
import classes from "./SearchFilterButton.module.css";
import { SearchFilterPanel } from "./SearchFilterPanel";

/**
 * The panel's open state when its parent keeps it: /search swaps its Explore page for the results as
 * soon as a filter is set, and the panel stays open across the swap. Left out, the button keeps it.
 */
export type FilterPanelState = Readonly<{
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
}>;

type Props = FilterPanelState &
  Readonly<{
    filters: SearchFilters;
    onChange: (patch: SearchFilters) => void;
    onClear: () => void;
    /** See RatingFilter. */
    favoriteRating: number | undefined;
    /** The photos the search lists now, for the phone sheet's "Show N photos". */
    resultCount: number;
  }>;

const PANEL_WIDTH = 440;

// The search page's Filters button (#2259), the timeline filter's look on another page: a popover
// with every filter on a desktop, a bottom sheet on a phone. Changes apply at once.
export function SearchFilterButton(props: Props) {
  const { filters, onChange, onClear, favoriteRating, resultCount } = props;
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // On a phone the header has no room for a labelled button next to the title.
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [opened, setOpened] = useUncontrolled({
    value: props.opened,
    defaultValue: false,
    finalValue: false,
    onChange: props.onOpenedChange,
  });
  const open = () => setOpened(true);
  const close = () => setOpened(false);
  const toggle = () => setOpened(!opened);
  const { data: people = [] } = useFetchPeopleAlbumsQuery(!opened);
  const active = countSearchFilters(filters);
  const activeLabel = active > 0 ? t("searchfilter.activecount", { count: active }) : undefined;
  const name = activeLabel ? `${t("searchfilter.button")}, ${activeLabel}` : t("searchfilter.button");
  const look = toolbarLook(active > 0);

  const panel = (
    <SearchFilterPanel
      filters={filters}
      onChange={onChange}
      people={people}
      favoriteRating={favoriteRating}
      active={opened}
    />
  );

  if (compact) {
    return (
      <>
        <Indicator label={active} size={16} disabled={active === 0}>
          <ActionIcon {...look} size="lg" aria-label={name} onClick={toggle}>
            <IconFilter size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Indicator>
        <Drawer.Root opened={opened} onClose={close} position="bottom" size="85%">
          <Drawer.Overlay />
          <Drawer.Content className={classes.sheet}>
            <Drawer.Header>
              <Drawer.Title>{t("searchfilter.title")}</Drawer.Title>
              <Drawer.CloseButton />
            </Drawer.Header>
            <Drawer.Body className={classes.sheetBody}>{panel}</Drawer.Body>
            <Group grow p="md" className={classes.sheetFooter}>
              {active > 0 && (
                <Button variant="default" onClick={onClear}>
                  {t("searchfilter.clearall")}
                </Button>
              )}
              <Button onClick={close}>{t("searchfilter.show", { count: resultCount })}</Button>
            </Group>
          </Drawer.Content>
        </Drawer.Root>
      </>
    );
  }

  return (
    // Portaled: trap focus in it and hand it back to the button on close, like the timeline's.
    <Popover
      opened={opened}
      onChange={next => (next ? open() : close())}
      width={PANEL_WIDTH}
      position="bottom-end"
      shadow="md"
      withinPortal
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <Button
          {...look}
          h={TOOLBAR_CONTROL_HEIGHT}
          leftSection={<IconFilter size={18} />}
          onClick={toggle}
          rightSection={
            active > 0 ? (
              <Badge size="sm" circle aria-label={activeLabel}>
                {active}
              </Badge>
            ) : null
          }
        >
          {t("searchfilter.button")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown aria-label={t("searchfilter.title")} maw="calc(100vw - 2rem)" p={0}>
        <ScrollArea.Autosize mah="min(70vh, 720px)" type="auto" offsetScrollbars>
          <Stack gap="md" p="md">
            {panel}
            {active > 0 && (
              <Group justify="flex-end">
                <Button variant="subtle" size="compact-sm" onClick={onClear}>
                  {t("searchfilter.clearall")}
                </Button>
              </Group>
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
