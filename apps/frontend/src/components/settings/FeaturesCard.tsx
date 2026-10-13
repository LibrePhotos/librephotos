import type { SiteFeatureName, SiteFeatures, SiteModelDownload } from "@librephotos/api-client";
import { Badge, Card, Code, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { IconLock as Lock } from "@tabler/icons-react";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  useFollowModelDownload,
  useGetSettingsQuery,
  useUpdateSettingsMutation,
} from "../../api_client/settings/hooks";
import { notification } from "../../service/notifications";
import { FeatureModelStatus } from "./FeatureModelStatus";
import { SectionLink } from "./SettingsSection";
import { envVariable, FEATURE_ROWS, modelStatus } from "./siteFeatures";

type FeatureRowProps = {
  row: (typeof FEATURE_ROWS)[number];
  state: SiteFeatures[SiteFeatureName];
  /** The value being saved, shown until the server answers. */
  pending: boolean | undefined;
  download: SiteModelDownload | null | undefined;
  onChange: (enabled: boolean) => void;
};

function LockedNote({ name }: { name: SiteFeatureName }) {
  return (
    <Text fz="xs" c="dimmed">
      <Trans
        i18nKey="sitesettings.feature_locked_description"
        values={{ variable: envVariable(name) }}
        components={{ code: <Code fz="xs" /> }}
      />
    </Text>
  );
}

function FeatureRow({ row, state, pending, download, onChange }: FeatureRowProps) {
  const { t } = useTranslation();
  const id = `site-feature-${row.name}`;
  const checked = pending ?? state.enabled;
  const status = modelStatus({ ...state, enabled: checked }, download);

  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Switch
        id={id}
        checked={checked}
        disabled={state.locked}
        onChange={event => onChange(event.currentTarget.checked)}
        aria-describedby={`${id}-description`}
        mt={2}
      />
      <Stack gap={2} miw={0}>
        <Group gap="xs">
          <Text component="label" htmlFor={id} fz="sm" c={state.locked ? "dimmed" : undefined}>
            {t(row.label)}
          </Text>
          {state.locked && (
            <Badge size="xs" variant="light" color="gray" leftSection={<Lock size={10} aria-hidden />}>
              {t("sitesettings.feature_locked")}
            </Badge>
          )}
        </Group>
        <Stack gap={2} id={`${id}-description`}>
          {state.locked ? (
            <LockedNote name={row.name} />
          ) : (
            <Text fz="xs" c="dimmed">
              {t(row.description)}
              {!checked && ` ${t(row.off)}`}
            </Text>
          )}
          <FeatureModelStatus
            status={status}
            download={download}
            onRetry={() => onChange(true)}
            retrying={pending === true}
          />
        </Stack>
      </Stack>
    </Group>
  );
}

/**
 * The Features card of the site settings (#2217): one switch per optional ML feature, saved at
 * once like the other site settings. A switch the server environment turned off is locked and
 * names the variable; the model line under a switch follows the download turning it on started.
 */
export function FeaturesCard() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const { mutate: saveSettings } = useUpdateSettingsMutation();
  const [pending, setPending] = useState<Partial<Record<SiteFeatureName, boolean>>>({});
  const download = useFollowModelDownload(settings?.model_download);

  const features = settings?.features;
  // Older backends, and anyone but staff, have no switches to show.
  if (!features) {
    return null;
  }

  const save = (row: (typeof FEATURE_ROWS)[number], enabled: boolean) => {
    setPending(current => ({ ...current, [row.name]: enabled }));
    saveSettings(row.update(enabled), {
      onSuccess: () => notification.success(t("sitesettings.saved"), { id: "site-settings-saved", autoClose: 1500 }),
      // The answer decides the switch again; a refused save is toasted by the QueryClient and the
      // switch falls back to the stored value.
      onSettled: () => setPending(({ [row.name]: _done, ...rest }) => rest),
    });
  };

  return (
    <Card shadow="md">
      <Stack>
        <Stack gap={4}>
          <Title order={4}>
            {t("sitesettings.features_header")}
            <SectionLink />
          </Title>
          <Text fz="sm" c="dimmed">
            {t("sitesettings.features_description")}
          </Text>
        </Stack>
        {FEATURE_ROWS.map(row => (
          <FeatureRow
            key={row.name}
            row={row}
            state={features[row.name]}
            pending={pending[row.name]}
            download={download}
            onChange={enabled => save(row, enabled)}
          />
        ))}
      </Stack>
    </Card>
  );
}
