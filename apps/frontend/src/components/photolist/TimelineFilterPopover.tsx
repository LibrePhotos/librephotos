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
import { useMediaQuery } from "@mantine/hooks";
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
import {
  countActiveFilters,
  describeTimelineFilter,
  isTimelineMedia,
  sameTimelineFilter,
  type TimelineFilter,
} from "./timelineFilter";

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
    <Text size="xs" fw={700} c="dimmed" tt="uppercase">
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

  return (
    // The dropdown is portaled: trap focus in it and hand it back to the
    // button on close, so keyboard users can reach the controls.
    <Popover width={320} position="bottom-end" shadow="md" withinPortal trapFocus returnFocus>
      {compact ? (
        // The badge goes on the Indicator, outside the target, so the
        // ActionIcon itself carries the popover's aria attributes.
        <Indicator label={active} size={16} disabled={active === 0}>
          <Popover.Target>
            <ActionIcon
              variant={active > 0 ? "light" : "subtle"}
              color={active > 0 ? "blue" : "gray"}
              size="lg"
              disabled={!ready}
              aria-label={activeLabel ? `${t("timelinefilter.button")}, ${activeLabel}` : t("timelinefilter.button")}
            >
              <Filter size={20} />
            </ActionIcon>
          </Popover.Target>
        </Indicator>
      ) : (
        <Popover.Target>
          <Button
            variant={active > 0 ? "light" : "subtle"}
            color={active > 0 ? "blue" : "gray"}
            leftSection={<Filter size={18} />}
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
      )}
      <Popover.Dropdown aria-label={t("timelinefilter.title")} style={{ maxWidth: "calc(100vw - 2rem)" }}>
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
                <Star size={16} color="var(--mantine-color-yellow-6)" />
                {t("timelinefilter.favorites")}
              </Group>
            }
          />

          <Divider />
          {isDefault ? (
            <Group gap={6} wrap="nowrap">
              <Check size={16} color="var(--mantine-color-green-text)" />
              <Text size="sm" c="var(--mantine-color-green-text)">
                {t("timelinefilter.isdefault")}
              </Text>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              {t("timelinefilter.yourdefault", { summary: describeTimelineFilter(saved, t, i18nResolvedLanguage()) })}
            </Text>
          )}
          <Group justify="space-between">
            <Button variant="subtle" size="compact-sm" disabled={isDefault} onClick={onReset}>
              {t("timelinefilter.reset")}
            </Button>
            <Button size="compact-sm" disabled={isDefault} loading={saving} onClick={onSaveDefault}>
              {t("timelinefilter.save")}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
