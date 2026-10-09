import { Badge, Button, Divider, Group, Popover, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import {
  IconCheck as Check,
  IconFileText as FileText,
  IconFilter as Filter,
  IconScreenshot as Screenshot,
  IconStar as Star,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  countActiveFilters,
  describeTimelineFilter,
  sameTimelineFilter,
  type TimelineFilter,
  type TimelineMedia,
} from "./timelineFilter";

type Props = Readonly<{
  // The filter on screen and the user's saved default, both fully resolved.
  current: TimelineFilter;
  saved: TimelineFilter;
  onChange: (filter: TimelineFilter) => void;
  onReset: () => void;
  onSaveDefault: () => void;
  saving?: boolean;
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
export function TimelineFilterPopover({ current, saved, onChange, onReset, onSaveDefault, saving = false }: Props) {
  const { t } = useTranslation();
  const active = countActiveFilters(current);
  const isDefault = sameTimelineFilter(current, saved);
  const set = (patch: Partial<TimelineFilter>) => onChange({ ...current, ...patch });

  return (
    <Popover width={320} position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <Button
          variant={active > 0 ? "light" : "subtle"}
          color={active > 0 ? "blue" : "gray"}
          leftSection={<Filter size={18} />}
          rightSection={
            active > 0 ? (
              <Badge size="sm" circle aria-label={t("timelinefilter.activecount", { count: active })}>
                {active}
              </Badge>
            ) : null
          }
        >
          {t("timelinefilter.button")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown aria-label={t("timelinefilter.title")}>
        <Stack gap="sm">
          <SectionLabel>{t("timelinefilter.mediatype")}</SectionLabel>
          <SegmentedControl
            fullWidth
            value={current.media}
            onChange={value => set({ media: value as TimelineMedia })}
            data={[
              { value: "all", label: t("timelinefilter.media.all") },
              { value: "photos", label: t("timelinefilter.media.photos") },
              { value: "videos", label: t("timelinefilter.media.videos") },
            ]}
          />

          <SectionLabel>{t("timelinefilter.hide")}</SectionLabel>
          <Switch
            checked={current.hide_screenshots}
            onChange={event => set({ hide_screenshots: event.currentTarget.checked })}
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
              <Check size={16} color="var(--mantine-color-green-7)" />
              <Text size="sm" c="green.8">
                {t("timelinefilter.isdefault")}
              </Text>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              {t("timelinefilter.yourdefault", { summary: describeTimelineFilter(saved, t) })}
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
