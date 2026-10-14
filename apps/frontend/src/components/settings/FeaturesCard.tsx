import type { SiteFeatureName, SiteModelDownload } from "@librephotos/api-client";
import { Badge, Box, Card, Code, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { IconInfoCircle as InfoCircle, IconLock as Lock } from "@tabler/icons-react";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  useFollowModelDownload,
  useGetSettingsQuery,
  useUpdateSettingsMutation,
} from "../../api_client/settings/hooks";
import { notification } from "../../service/notifications";
import { FeatureModelStatus } from "./FeatureModelStatus";
import classes from "./FeaturesCard.module.css";
import { SectionLink } from "./SettingsSection";
import type { SiteFeatureState } from "./siteFeatures";
import { envVariable, FEATURE_ROWS, modelStatus } from "./siteFeatures";

type Row = (typeof FEATURE_ROWS)[number];

type FeatureRowProps = {
  row: Row;
  state: SiteFeatureState;
  /** The value being saved, shown until the server answers. */
  pending: boolean | undefined;
  /** The feature this row refines is off, so its switch does nothing for now. */
  parentOff: boolean;
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

/** What the switch does and, while it is off, what that skips. */
function FeatureDescription({ row, checked, parentOff }: { row: Row; checked: boolean; parentOff: boolean }) {
  const { t } = useTranslation();
  const off = !checked && !parentOff;
  return (
    <>
      <Text fz="xs" c="dimmed">
        {t(row.description)}
        {off && ` ${t(row.off)}`}
      </Text>
      {off && row.offNote && (
        <Group gap={4} wrap="nowrap" align="flex-start">
          <InfoCircle size={14} aria-hidden className={classes.noteIcon} />
          <Text fz="xs" c="dimmed">
            {t(row.offNote)}
          </Text>
        </Group>
      )}
    </>
  );
}

function FeatureRow({ row, state, pending, parentOff, download, onChange }: FeatureRowProps) {
  const { t } = useTranslation();
  const id = `site-feature-${row.name}`;
  const checked = pending ?? state.enabled;
  const status = modelStatus({ ...state, enabled: checked }, download);
  const disabled = state.locked || parentOff;

  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.currentTarget.checked)}
        aria-describedby={`${id}-description`}
        mt={2}
      />
      <Stack gap={2} miw={0}>
        <Group gap="xs">
          <Text component="label" htmlFor={id} fz="sm" c={disabled ? "dimmed" : undefined}>
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
            <FeatureDescription row={row} checked={checked} parentOff={parentOff} />
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

/** A row that refines another (the animated previews under Videos), indented under it. */
function SubFeature({ children }: { children: React.ReactNode }) {
  return <Box className={classes.subFeature}>{children}</Box>;
}

/**
 * The Features card of the site settings (#2217): one switch per optional feature, saved at
 * once like the other site settings. A switch the server environment turned off is locked and
 * names the variable; the model line under a switch follows the download turning it on started.
 * A sub-switch (#649) sits indented under its feature and is disabled while that one is off.
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

  const isOn = (name: SiteFeatureName) => pending[name] ?? features[name]?.enabled ?? true;

  const save = (row: Row, enabled: boolean) => {
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
        {FEATURE_ROWS.map(row => {
          const state = features[row.name];
          // A switch an older backend does not have yet.
          if (!state) return null;
          const featureRow = (
            <FeatureRow
              key={row.name}
              row={row}
              state={state}
              pending={pending[row.name]}
              parentOff={row.parent !== undefined && !isOn(row.parent)}
              download={download}
              onChange={enabled => save(row, enabled)}
            />
          );
          return row.parent ? <SubFeature key={row.name}>{featureRow}</SubFeature> : featureRow;
        })}
      </Stack>
    </Card>
  );
}
