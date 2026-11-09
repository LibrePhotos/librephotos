import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Indicator,
  Popover,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconCheck as Check,
  IconFileText as FileText,
  IconFilter as Filter,
  IconScreenshot as Screenshot,
  IconStar as Star,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { i18nResolvedLanguage } from "../../i18n";
import { FAVORITE_COLOR, ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { BottomSheet } from "../common/BottomSheet";
import { toolbarLook } from "../common/toolbarLook";
import {
  countActiveFilters,
  describeTimelineFilter,
  isTimelineMedia,
  sameTimelineFilter,
  type TimelineFilter,
} from "./timelineFilter";
import classes from "./TimelineFilterPopover.module.css";

type Props = Readonly<{
  // The filter on screen and the user's saved default, both fully resolved.
  current: TimelineFilter;
  saved: TimelineFilter;
  onChange: (filter: TimelineFilter) => void;
  onReset: () => void;
  onSaveDefault: () => void;
  saving?: boolean;
  // False until the saved default has loaded: there is nothing to compare
  // the view with, or to reset to, before that.
  ready?: boolean;
}>;

function SectionLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Text size="xs" fw={600} c="dimmed">
      {children}
    </Text>
  );
}

// The main timeline's Filter button and popover (issue #2130): media type,
// screenshots and documents to hide, favorites only, and the saved default.
export function TimelineFilterPopover({
  current,
  saved,
  onChange,
  onReset,
  onSaveDefault,
  saving = false,
  ready = true,
}: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // On a phone the header has no room for a labelled button next to the title.
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const active = countActiveFilters(current);
  const isDefault = sameTimelineFilter(current, saved);
  // The controls are frozen while the default saves: the save clears the
  // URL's overrides when it lands, which would drop a change made meanwhile.
  const set = (patch: Partial<TimelineFilter>) => onChange({ ...current, ...patch });
  const activeLabel = active > 0 ? t("timelinefilter.activecount", { count: active }) : undefined;
  const buttonLabel = activeLabel ? `${t("timelinefilter.button")}, ${activeLabel}` : t("timelinefilter.button");
  const [sheetOpened, sheet] = useDisclosure(false);

  const panel = (
    <Stack gap="sm">
      <SectionLabel>{t("timelinefilter.mediatype")}</SectionLabel>
      <SegmentedControl
        fullWidth
        aria-label={t("timelinefilter.mediatype")}
        value={current.media}
        onChange={value => {
          // The options below are the three media types.
          if (isTimelineMedia(value)) set({ media: value });
        }}
        disabled={saving}
        data={[
          { value: "all", label: t("mediafilter.all") },
          { value: "photos", label: t("timelinefilter.media.photos") },
          { value: "videos", label: t("timelinefilter.media.videos") },
        ]}
      />

      <SectionLabel>{t("timelinefilter.hide")}</SectionLabel>
      <Switch
        checked={current.hide_screenshots}
        onChange={event => set({ hide_screenshots: event.currentTarget.checked })}
        disabled={saving}
        label={
          <Group gap={6} wrap="nowrap">
            <Screenshot size={16} color="var(--mantine-color-violet-6)" />
            {t("timelinefilter.screenshots")}
          </Group>
        }
      />
      <Switch
        checked={current.hide_documents}
        onChange={event => set({ hide_documents: event.currentTarget.checked })}
        disabled={saving}
        label={
          <Group gap={6} wrap="nowrap">
            <FileText size={16} color="var(--mantine-color-orange-7)" />
            {t("timelinefilter.documents")}
          </Group>
        }
      />

      <SectionLabel>{t("timelinefilter.showonly")}</SectionLabel>
      <Switch
        checked={current.favorites}
        onChange={event => set({ favorites: event.currentTarget.checked })}
        disabled={saving}
        label={
          <Group gap={6} wrap="nowrap">
            <Star size={16} color={FAVORITE_COLOR} />
            {t("timelinefilter.favorites")}
          </Group>
        }
      />

      <Divider />
      {/* On the default view there is nothing to reset or save: one quiet line says so. */}
      {isDefault ? (
        <Group gap={6} wrap="nowrap" c="dimmed">
          <Check size={16} />
          <Text size="sm">{t("timelinefilter.isdefault")}</Text>
        </Group>
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {t("timelinefilter.yourdefault", { summary: describeTimelineFilter(saved, t, i18nResolvedLanguage()) })}
          </Text>
          <Group justify="space-between">
            <Button variant="subtle" size="compact-sm" onClick={onReset} disabled={saving}>
              {t("timelinefilter.reset")}
            </Button>
            <Button size="compact-sm" loading={saving} onClick={onSaveDefault}>
              {t("timelinefilter.save")}
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );

  if (compact) {
    // A phone gets the filters in a bottom sheet, as the search page's.
    return (
      <>
        <Indicator label={active} size={16} disabled={active === 0}>
          <ActionIcon
            {...toolbarLook(active > 0)}
            size={TOOLBAR_ACTION_SIZE}
            disabled={!ready}
            aria-label={buttonLabel}
            aria-haspopup="dialog"
            onClick={sheet.open}
          >
            <Filter size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Indicator>
        <BottomSheet opened={sheetOpened} onClose={sheet.close} title={t("timelinefilter.title")}>
          <div className={classes.sheetBody}>{panel}</div>
        </BottomSheet>
      </>
    );
  }

  return (
    // The dropdown is portaled: trap focus in it and hand it back to the
    // button on close, so keyboard users can reach the controls.
    <Popover width={320} position="bottom-end" shadow="md" withinPortal trapFocus returnFocus>
      <Popover.Target>
        <Button
          {...toolbarLook(active > 0)}
          h={TOOLBAR_CONTROL_HEIGHT}
          leftSection={<Filter size={ICON_SIZE.toolbar} />}
          disabled={!ready}
          rightSection={
            active > 0 ? (
              <Badge size="sm" circle aria-label={activeLabel}>
                {active}
              </Badge>
            ) : null
          }
        >
          {t("timelinefilter.button")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown aria-label={t("timelinefilter.title")} style={{ maxWidth: "calc(100vw - 2rem)" }}>
        {panel}
      </Popover.Dropdown>
    </Popover>
  );
}
