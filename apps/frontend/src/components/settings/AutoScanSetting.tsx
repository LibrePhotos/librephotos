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
import { Info } from "luxon";
import React, { useEffect, useState } from "react";
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
import { useSaveSiteSettings } from "./useSaveSiteSettings";

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
        <Icon size={ICON_SIZE.menu} aria-hidden />
      </Text>
      <Text fz="sm" c={color}>
        {text}
      </Text>
    </Group>
  );
}

/** The start time: saved on blur and on Enter, when it is a whole time and changed. */
function StartTime({ stored, onSave }: { stored: string; onSave: (time: string) => void }) {
  const { t } = useTranslation();
  const [time, setTime] = useState(stored);

  useEffect(() => setTime(stored), [stored]);

  const commit = () => {
    if (!TIME.test(time)) {
      setTime(stored);
      return;
    }
    if (time !== stored) onSave(time);
  };

  return (
    <Group gap="xs" wrap="nowrap">
      <Text fz="sm" c="dimmed">
        {t("sitesettings.autoscanat")}
      </Text>
      <TimeInput
        aria-label={t("sitesettings.autoscantime")}
        leftSection={<IconClock size={ICON_SIZE.inline} />}
        value={time}
        onChange={event => setTime(event.currentTarget.value)}
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
function Weekdays({ stored, onSave }: { stored: number[]; onSave: (days: number[]) => void }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(stored.map(String));
  const names = Info.weekdays("short");

  useEffect(() => setDays(stored.map(String)), [stored]);

  const change = (next: string[]) => {
    setDays(next);
    if (next.length) onSave(next.map(Number).sort((a, b) => a - b));
  };

  return (
    <Stack gap={4}>
      <Chip.Group multiple value={days} onChange={change}>
        <Group gap={4} role="group" aria-label={t("sitesettings.autoscandays")}>
          {weekdayOrder().map(day => (
            <Chip key={day} value={String(day)} size="xs">
              {names[day]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {days.length === 0 && (
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
  const { data: settings, dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const stored = settings?.auto_scan;
  const [frequency, setFrequency] = useState<AutoScanFrequency>(isAutoScanFrequency(stored) ? stored : "off");

  useEffect(() => {
    setFrequency(isAutoScanFrequency(stored) ? stored : "off");
    // dataUpdatedAt: a reload that brings back the same value still resets the control
  }, [stored, dataUpdatedAt]);

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
              if (!isAutoScanFrequency(value)) return;
              setFrequency(value);
              save({ auto_scan: value });
            }}
          />
          {frequency === "custom" && (
            <Weekdays stored={settings.auto_scan_days ?? NO_DAYS} onSave={days => save({ auto_scan_days: days })} />
          )}
          {timed && (
            <StartTime stored={settings.auto_scan_time ?? "03:00"} onSave={time => save({ auto_scan_time: time })} />
          )}
        </Stack>
      </Grid.Col>
    </>
  );
}
