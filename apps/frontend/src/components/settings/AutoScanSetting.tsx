import type { SiteAutoScanStatus } from "@librephotos/api-client";
import { Chip, Grid, Group, Select, Stack, Text } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconPlayerSkipForward,
  IconRefresh,
  type TablerIcon,
} from "@tabler/icons-react";
import { isEqual } from "lodash-es";
import { Info } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { firstDayOfWeek } from "../../util/dateUtils";
import {
  AUTO_SCAN_FREQUENCIES,
  autoScanStatusLine,
  isAutoScanFrequency,
  type AutoScanFrequency,
  type AutoScanTone,
} from "./autoScanStatus";
import { CONTROL_SPAN, LABEL_SPAN } from "./ScanSettings";
import { useSiteSettingDraft } from "./useSiteSettingDraft";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_DAYS: number[] = [];

const TONES: Record<AutoScanTone, { icon: TablerIcon; color: string }> = {
  idle: { icon: IconClock, color: "dimmed" },
  ok: { icon: IconCheck, color: "dimmed" },
  running: { icon: IconRefresh, color: "blue" },
  skipped: { icon: IconPlayerSkipForward, color: "orange" },
  failed: { icon: IconAlertTriangle, color: "red" },
};

/** The weekdays as the backend numbers them (0 is Monday), in the order the locale's week runs. */
function weekdayOrder(): number[] {
  const mondayFirst = [0, 1, 2, 3, 4, 5, 6];
  return firstDayOfWeek() === 0 ? [6, ...mondayFirst.slice(0, 6)] : mondayFirst;
}

function StatusLine({ status }: { status: SiteAutoScanStatus }) {
  const { t } = useTranslation();
  const { tone, text } = autoScanStatusLine(status, t);
  const { icon: Icon, color } = TONES[tone];
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" mt={6} role="status">
      <Text component="span" c={tone === "ok" ? "green" : color} lh={0} mt={3}>
        <Icon size={ICON_SIZE.inline} aria-hidden />
      </Text>
      <Text fz="sm" c={color}>
        {text}
      </Text>
    </Group>
  );
}

/** The start time: saved on blur and on Enter, when it is a whole time and changed. */
function StartTime({ stored }: { stored: string }) {
  const { t } = useTranslation();
  const time = useSiteSettingDraft(stored, value => ({ auto_scan_time: value }));

  const commit = () => {
    if (TIME.test(time.value)) void time.commit();
    else time.discard();
  };

  return (
    <Group gap="xs" wrap="nowrap">
      <Text fz="sm" c="dimmed">
        {t("sitesettings.autoscanat")}
      </Text>
      <TimeInput
        aria-label={t("sitesettings.autoscantime")}
        leftSection={<IconClock size={ICON_SIZE.inline} />}
        value={time.value}
        onChange={event => time.edit(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") commit();
        }}
        flex={1}
      />
    </Group>
  );
}

/** The custom days. Without a day nothing is saved and the saved schedule stays. */
function Weekdays({ stored }: { stored: number[] }) {
  const { t } = useTranslation();
  const days = useSiteSettingDraft(stored, value => ({ auto_scan_days: value }), isEqual);
  const names = Info.weekdays("short");

  const change = (picked: string[]) => {
    const next = picked.map(Number).sort((a, b) => a - b);
    if (next.length) void days.commit(next);
    else days.edit(next);
  };

  return (
    <Stack gap={4}>
      <Chip.Group multiple value={days.value.map(String)} onChange={change}>
        <Group gap={4} role="group" aria-label={t("sitesettings.autoscandays")}>
          {weekdayOrder().map(day => (
            <Chip key={day} value={String(day)} size="xs">
              {names[day]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {days.value.length === 0 && (
        <Text fz="xs" c="red" role="alert">
          {t("sitesettings.autoscanpickaday")}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Scan every library on a schedule (#235): off, every hour, every day at a time, or on the picked
 * days at a time. The time is the server's. One status line under the description says what the
 * last run did and when the next one is. Saved on change, like the other site settings.
 */
export function AutoScanSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const stored = settings?.auto_scan;
  const draft = useSiteSettingDraft<AutoScanFrequency>(isAutoScanFrequency(stored) ? stored : "off", value => ({
    auto_scan: value,
  }));
  const frequency = draft.value;

  // Staff only, and older backends have no schedule.
  if (!settings || stored === undefined) return null;
  const status = settings.auto_scan_status;
  const timed = frequency === "daily" || frequency === "custom";
  const header = t("sitesettings.autoscanheader");

  return (
    <>
      <Grid.Col span={LABEL_SPAN}>
        <Stack gap={0}>
          <Text>{header}</Text>
          <Text fz="sm" c="dimmed">
            {t("sitesettings.autoscandescription")}
            {timed && status && ` ${t("sitesettings.autoscantimezone", { zone: status.time_zone })}`}
          </Text>
          {status && frequency !== "off" && <StatusLine status={status} />}
        </Stack>
      </Grid.Col>
      <Grid.Col span={CONTROL_SPAN}>
        <Stack gap="xs">
          <Select
            aria-label={header}
            allowDeselect={false}
            data={AUTO_SCAN_FREQUENCIES.map(value => ({ value, label: t(`sitesettings.autoscan_${value}`) }))}
            value={frequency}
            onChange={value => {
              if (isAutoScanFrequency(value)) void draft.commit(value);
            }}
          />
          {frequency === "custom" && <Weekdays stored={settings.auto_scan_days ?? NO_DAYS} />}
          {timed && <StartTime stored={settings.auto_scan_time ?? "03:00"} />}
        </Stack>
      </Grid.Col>
    </>
  );
}
