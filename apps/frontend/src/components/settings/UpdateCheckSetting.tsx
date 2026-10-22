import type { UpdateStatus } from "@librephotos/api-client";
import { Anchor, Badge, Code, Group, Stack, Switch, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconDownload,
  IconLock as Lock,
  type TablerIcon,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFetchImageTagQuery, useSkipReleaseMutation, useUpdateStatusQuery } from "../../api_client/server";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { updateCheckStatusLine, type UpdateCheckTone } from "./updateCheckStatus";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

const TONES: Record<UpdateCheckTone, { icon: TablerIcon; color: string }> = {
  idle: { icon: IconClock, color: "dimmed" },
  ok: { icon: IconCheck, color: "dimmed" },
  available: { icon: IconDownload, color: "blue" },
  failed: { icon: IconAlertTriangle, color: "orange" },
};

/** What the last check found; a skipped release offers Show it again. */
function StatusLine({ status }: Readonly<{ status: UpdateStatus }>) {
  const { t } = useTranslation();
  const { data: imageInfos } = useFetchImageTagQuery();
  const skip = useSkipReleaseMutation();
  const line = updateCheckStatusLine(status, imageInfos?.git_hash, t);
  if (!line) return null;
  const { icon: Icon, color } = TONES[line.tone];
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" role="status">
      <Text component="span" c={line.tone === "ok" ? "green" : color} lh={0} mt={3}>
        <Icon size={ICON_SIZE.menu} aria-hidden />
      </Text>
      <Text fz="xs" c={color}>
        {line.text}
        {status.status === "skipped" ? (
          <>
            {" "}
            <Anchor component="button" type="button" fz="xs" onClick={() => skip.mutate("")}>
              {t("sitesettings.updatecheck_showagain")}
            </Anchor>
          </>
        ) : null}
      </Text>
    </Group>
  );
}

/**
 * Check for new releases (#2311), in the Site Settings card: the daily update check's switch, what
 * it sends (nothing about the server), and what the last check found. Locked off when the server
 * environment says UPDATE_CHECK=false. Hidden for an older backend that does not send the switch.
 */
export function UpdateCheckSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const { data: status } = useUpdateStatusQuery({ enabled: settings?.update_check !== undefined });
  const save = useSaveSiteSettings();
  if (settings?.update_check === undefined) {
    return null;
  }
  const locked = status?.locked ?? false;
  const checked = settings.update_check && !locked;
  const id = "site-update-check";
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Switch
        id={id}
        checked={checked}
        disabled={locked}
        onChange={() => save({ update_check: !checked })}
        aria-describedby={`${id}-description`}
        mt={2}
      />
      <Stack gap={2} miw={0}>
        <Group gap="xs">
          <Text component="label" htmlFor={id} fz="sm" c={locked ? "dimmed" : undefined}>
            {t("sitesettings.updatecheck")}
          </Text>
          {locked ? (
            <Badge size="xs" variant="light" color="gray" leftSection={<Lock size={10} aria-hidden />}>
              {t("sitesettings.feature_locked")}
            </Badge>
          ) : null}
        </Group>
        <Stack gap={4} id={`${id}-description`}>
          <Text fz="xs" c="dimmed">
            {locked ? (
              <Trans i18nKey="sitesettings.updatecheck_locked" components={{ code: <Code fz="xs" /> }} />
            ) : (
              t("sitesettings.updatecheck_description")
            )}
          </Text>
          {status && !locked ? <StatusLine status={status} /> : null}
        </Stack>
      </Stack>
    </Group>
  );
}
